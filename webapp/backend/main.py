"""
FastAPI backend for the MarkItDown web app.

Uses the local, editable `markitdown` package from this repo (packages/markitdown)
-- not a PyPI install -- so it always reflects whatever's currently in the
working tree (chunking strategies, converters, etc).
"""

import io
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from markitdown import MarkItDown, StreamInfo
from markitdown.chunking import (
    CharacterChunker,
    RecursiveCharacterChunker,
    TokenChunker,
)
from markitdown._exceptions import MarkItDownException

import db

app = FastAPI(title="MarkItDown Web")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # allow_credentials=True is incompatible with allow_origins=["*"] --
    # browsers reject that combination outright. This app doesn't use
    # cookies/auth, so credentials aren't needed.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One shared MarkItDown instance -- construction just registers converters,
# no per-request state, safe to reuse across requests.
_markitdown = MarkItDown()

CHUNK_STRATEGIES = {"character", "recursive", "token"}

# Projects/files live in SQLite (backend/data/app.db). See db.py. This also
# imports any legacy data/projects.json on first run.
db.init_db()


class ChunkOut(BaseModel):
    text: str
    metadata: dict


class ConvertResponse(BaseModel):
    filename: str
    title: Optional[str] = None
    markdown: str
    chunks: Optional[List[ChunkOut]] = None


# ---- Project models -------------------------------------------------------


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Project name")
    description: Optional[str] = Field(
        default=None, max_length=500, description="Short description"
    )
    chunk_strategy: Optional[str] = Field(default=None)
    chunk_size: Optional[int] = Field(default=None, ge=1)
    chunk_overlap: int = Field(default=0, ge=0)
    chunk_model: Optional[str] = Field(default=None, max_length=100)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)
    chunk_strategy: Optional[str] = None
    chunk_size: Optional[int] = Field(default=None, ge=1)
    chunk_overlap: Optional[int] = Field(default=None, ge=0)
    chunk_model: Optional[str] = Field(default=None, max_length=100)


class ProjectOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    chunk_strategy: Optional[str] = None
    chunk_size: Optional[int] = None
    chunk_overlap: int = 0
    chunk_model: Optional[str] = None
    created_at: str
    updated_at: str
    file_count: int = 0


class ProjectFileOut(BaseModel):
    id: str
    filename: str
    title: Optional[str] = None
    markdown: str
    created_at: str
    chars: int = 0


@app.get("/api/health")
def health():
    return {"status": "ok"}


_TOKENIZER_FILE_MARKERS = (
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "vocab.txt",
    "spiece.model",
)


class TokenizerCheckOut(BaseModel):
    valid: bool
    source: Optional[str] = None  # "tiktoken" | "huggingface"
    message: str


# Common OpenAI model names tiktoken recognizes -- these aren't on the
# Hugging Face Hub, so they can't come from the search API below and are
# matched server-side by substring instead. Not exhaustive (tiktoken also
# knows long-deprecated names like text-davinci-003); this is the
# actively-used subset worth suggesting.
OPENAI_MODEL_PRESETS = (
    "gpt-5",
    "gpt-4.1",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
    "gpt2",
    "o1",
    "o3",
    "o4-mini",
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
)


class ModelSearchResult(BaseModel):
    id: str
    downloads: Optional[int] = None


class ModelSearchOut(BaseModel):
    openai: List[str]
    huggingface: List[ModelSearchResult]


@app.get("/api/model-search", response_model=ModelSearchOut)
def model_search(q: str = "", limit: int = 8):
    q = q.strip()
    openai_matches = [m for m in OPENAI_MODEL_PRESETS if q.lower() in m.lower()][:5]

    hf_matches: List[ModelSearchResult] = []
    try:
        from huggingface_hub import HfApi

        api = HfApi()
        # Over-fetch since we filter down to repos that actually publish
        # tokenizer files, then trim to `limit`.
        candidates = api.list_models(
            search=q or None,
            limit=limit * 3,
            sort="downloads",
            expand=["siblings"],
        )
        for m in candidates:
            siblings = {s.rfilename for s in (m.siblings or [])}
            if siblings & set(_TOKENIZER_FILE_MARKERS):
                hf_matches.append(ModelSearchResult(id=m.id, downloads=m.downloads))
            if len(hf_matches) >= limit:
                break
    except Exception:
        # Search is best-effort; an empty result just means no suggestions.
        pass

    return ModelSearchOut(openai=openai_matches, huggingface=hf_matches)


@app.get("/api/tokenizer-check", response_model=TokenizerCheckOut)
def tokenizer_check(model: str):
    model = model.strip()
    if not model:
        raise HTTPException(status_code=400, detail="model is required.")

    try:
        import tiktoken

        tiktoken.encoding_for_model(model)
        return TokenizerCheckOut(
            valid=True, source="tiktoken", message="Recognized OpenAI model."
        )
    except Exception:
        pass

    try:
        from huggingface_hub import HfApi
        from huggingface_hub.errors import GatedRepoError, RepositoryNotFoundError

        info = HfApi().model_info(model, files_metadata=False)
        has_tokenizer = any(
            s.rfilename in _TOKENIZER_FILE_MARKERS for s in (info.siblings or [])
        )
        if has_tokenizer:
            return TokenizerCheckOut(
                valid=True,
                source="huggingface",
                message="Tokenizer found on Hugging Face.",
            )
        return TokenizerCheckOut(
            valid=False,
            message="This model repo exists but doesn't publish tokenizer files.",
        )
    except GatedRepoError:
        return TokenizerCheckOut(
            valid=False,
            message="This is a gated model — authenticate with HF_TOKEN to use it.",
        )
    except RepositoryNotFoundError:
        return TokenizerCheckOut(
            valid=False, message="No such model found on Hugging Face."
        )
    except Exception:
        return TokenizerCheckOut(
            valid=False,
            message="Couldn't verify this model (network issue or invalid name).",
        )


@app.post("/api/convert", response_model=ConvertResponse)
async def convert(
    file: UploadFile = File(...),
    chunk_strategy: Optional[str] = Form(None),
    chunk_size: Optional[int] = Form(None),
    chunk_overlap: int = Form(0),
    chunk_model: Optional[str] = Form(None),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    stream_info = StreamInfo(filename=file.filename)

    try:
        result = _markitdown.convert_stream(io.BytesIO(data), stream_info=stream_info)
    except MarkItDownException as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Conversion failed unexpectedly: {e}"
        )

    chunks_out: Optional[List[ChunkOut]] = None
    if chunk_strategy:
        if chunk_strategy not in CHUNK_STRATEGIES:
            raise HTTPException(
                status_code=400,
                detail=f"chunk_strategy must be one of {sorted(CHUNK_STRATEGIES)}",
            )
        if not chunk_size or chunk_size <= 0:
            raise HTTPException(
                status_code=400, detail="chunk_size is required and must be > 0."
            )

        try:
            if chunk_strategy == "token":
                chunker = TokenChunker(
                    chunk_size=chunk_size,
                    chunk_overlap=chunk_overlap,
                    model=chunk_model,
                )
            elif chunk_strategy == "recursive":
                chunker = RecursiveCharacterChunker(
                    chunk_size=chunk_size, chunk_overlap=chunk_overlap
                )
            else:
                chunker = CharacterChunker(
                    chunk_size=chunk_size, chunk_overlap=chunk_overlap
                )
        except (ValueError, MarkItDownException) as e:
            raise HTTPException(status_code=400, detail=str(e))

        chunks = chunker.chunk(result.markdown, filename=file.filename)
        chunks_out = [ChunkOut(text=c.text, metadata=c.metadata) for c in chunks]

    return ConvertResponse(
        filename=file.filename,
        title=result.title,
        markdown=result.markdown,
        chunks=chunks_out,
    )


# ---------------------------------------------------------------------------
# Projects API
# ---------------------------------------------------------------------------


@app.get("/api/projects", response_model=List[ProjectOut])
def list_projects():
    return [ProjectOut(**p) for p in db.list_projects()]


@app.post("/api/projects", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required.")

    # Chunk validation if strategy provided
    if payload.chunk_strategy is not None:
        if payload.chunk_strategy not in CHUNK_STRATEGIES:
            raise HTTPException(
                status_code=400,
                detail=f"chunk_strategy must be one of {sorted(CHUNK_STRATEGIES)}",
            )
        if payload.chunk_strategy and (
            payload.chunk_size is None or payload.chunk_size <= 0
        ):
            raise HTTPException(
                status_code=400,
                detail="chunk_size is required and must be > 0 when chunk_strategy is set.",
            )

    if db.name_exists(name):
        raise HTTPException(
            status_code=409, detail=f'A project named "{name}" already exists.'
        )

    try:
        project = db.create_project(
            {
                "name": name,
                "description": payload.description.strip()
                if payload.description
                else None,
                "chunk_strategy": payload.chunk_strategy,
                "chunk_size": payload.chunk_size,
                "chunk_overlap": payload.chunk_overlap,
                "chunk_model": payload.chunk_model.strip()
                if payload.chunk_model
                else None,
            }
        )
    except db.DuplicateName:
        raise HTTPException(
            status_code=409, detail=f'A project named "{name}" already exists.'
        )
    return ProjectOut(**project)


@app.get("/api/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: str):
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectOut(**project)


@app.patch("/api/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, payload: ProjectUpdate):
    if not db.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")

    fields: dict = {}

    if payload.name is not None:
        n = payload.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Project name cannot be empty.")
        if db.name_exists(n, exclude_id=project_id):
            raise HTTPException(
                status_code=409, detail=f'A project named "{n}" already exists.'
            )
        fields["name"] = n

    if payload.description is not None:
        fields["description"] = payload.description.strip() or None

    if payload.chunk_strategy is not None:
        if payload.chunk_strategy and payload.chunk_strategy not in CHUNK_STRATEGIES:
            raise HTTPException(
                status_code=400,
                detail=f"chunk_strategy must be one of {sorted(CHUNK_STRATEGIES)}",
            )
        fields["chunk_strategy"] = payload.chunk_strategy or None

    if payload.chunk_size is not None:
        if payload.chunk_size <= 0:
            raise HTTPException(status_code=400, detail="chunk_size must be > 0.")
        fields["chunk_size"] = payload.chunk_size

    if payload.chunk_overlap is not None:
        if payload.chunk_overlap < 0:
            raise HTTPException(status_code=400, detail="chunk_overlap must be >= 0.")
        fields["chunk_overlap"] = payload.chunk_overlap

    if payload.chunk_model is not None:
        fields["chunk_model"] = payload.chunk_model.strip() or None

    try:
        project = db.update_project(project_id, fields)
    except db.DuplicateName:
        raise HTTPException(
            status_code=409, detail="A project with that name already exists."
        )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectOut(**project)


@app.post("/api/projects/{project_id}/touch", response_model=ProjectOut)
def touch_project(project_id: str):
    """Bump updated_at so the project surfaces as recently used. The Playground
    pings this after a conversion. (It no longer bumps a file count -- only
    real uploads via the /files endpoint do that.)"""
    project = db.touch_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectOut(**project)


# ---- Project files (many files per project) --------------------------------


@app.get("/api/projects/{project_id}/files", response_model=List[ProjectFileOut])
def list_project_files(project_id: str):
    if not db.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")
    return [ProjectFileOut(**f) for f in db.list_files(project_id)]


@app.post("/api/projects/{project_id}/files", response_model=List[ProjectFileOut])
async def upload_project_files(project_id: str, files: List[UploadFile] = File(...)):
    if not db.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    # Enforce reasonable limits
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Max 20 files per request.")

    new_records: List[dict] = []
    for upload in files:
        if not upload.filename:
            continue
        data = await upload.read()
        if not data:
            raise HTTPException(
                status_code=400, detail=f"File {upload.filename} is empty."
            )
        # 25 MB limit per file (backend also limited by proxy)
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(
                status_code=400, detail=f"{upload.filename} exceeds 25 MB."
            )

        stream_info = StreamInfo(filename=upload.filename)
        try:
            result = _markitdown.convert_stream(
                io.BytesIO(data), stream_info=stream_info
            )
        except MarkItDownException as e:
            raise HTTPException(status_code=422, detail=f"{upload.filename}: {e}")
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"{upload.filename}: conversion failed: {e}"
            )

        new_records.append(
            {
                "filename": upload.filename,
                "title": result.title,
                "markdown": result.markdown,
                "chars": len(result.markdown),
            }
        )

    if not new_records:
        raise HTTPException(status_code=400, detail="No valid files provided.")

    created = db.add_files(project_id, new_records)
    return [ProjectFileOut(**r) for r in created]


@app.delete("/api/projects/{project_id}/files/{file_id}", status_code=204)
def delete_project_file(project_id: str, file_id: str):
    if not db.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")
    if not db.delete_file(project_id, file_id):
        raise HTTPException(status_code=404, detail="File not found.")
    return None


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str):
    if not db.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")
    return None
