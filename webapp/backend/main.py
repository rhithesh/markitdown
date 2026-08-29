"""
FastAPI backend for the MarkItDown web app.

Uses the local, editable `markitdown` package from this repo (packages/markitdown)
-- not a PyPI install -- so it always reflects whatever's currently in the
working tree (chunking strategies, converters, etc).
"""

import io
import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

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

# ---------------------------------------------------------------------------
# Projects persistence (file-backed, thread-safe)
# ---------------------------------------------------------------------------
_DATA_DIR = Path(__file__).parent / "data"
_PROJECTS_FILE = _DATA_DIR / "projects.json"
_projects_lock = threading.Lock()
_projects_store: Dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_projects() -> None:
    if _PROJECTS_FILE.exists():
        try:
            raw = json.loads(_PROJECTS_FILE.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                for p in raw:
                    if isinstance(p, dict) and p.get("id"):
                        # backward-compat: ensure new fields exist
                        p.setdefault("files", [])
                        p.setdefault("file_count", len(p.get("files", [])))
                        _projects_store[p["id"]] = p
            elif isinstance(raw, dict):
                for pid, p in raw.items():
                    if isinstance(p, dict):
                        p.setdefault("files", [])
                        p.setdefault("file_count", len(p.get("files", [])))
                _projects_store.update(raw)
        except Exception:
            # Corrupt file -> start empty, don't crash boot
            pass


def _save_projects() -> None:
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        # Persist as list sorted by created_at desc for readability
        data = sorted(
            _projects_store.values(),
            key=lambda x: x.get("created_at", ""),
            reverse=True,
        )
        _PROJECTS_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        # Best-effort persistence; don't fail request on fs error
        pass


# Load at import time
_load_projects()


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
    with _projects_lock:
        projects = sorted(
            _projects_store.values(),
            key=lambda x: x.get("created_at", ""),
            reverse=True,
        )
        return [ProjectOut(**p) for p in projects]


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
        if payload.chunk_strategy and (payload.chunk_size is None or payload.chunk_size <= 0):
            raise HTTPException(
                status_code=400,
                detail="chunk_size is required and must be > 0 when chunk_strategy is set.",
            )

    now = _now_iso()
    pid = uuid.uuid4().hex[:12]

    project = {
        "id": pid,
        "name": name,
        "description": payload.description.strip() if payload.description else None,
        "chunk_strategy": payload.chunk_strategy,
        "chunk_size": payload.chunk_size,
        "chunk_overlap": payload.chunk_overlap,
        "chunk_model": payload.chunk_model.strip() if payload.chunk_model else None,
        "created_at": now,
        "updated_at": now,
        "file_count": 0,
        "files": [],
    }

    # Enforce unique name (case-insensitive)
    with _projects_lock:
        for p in _projects_store.values():
            if p["name"].lower() == name.lower():
                raise HTTPException(
                    status_code=409, detail=f'A project named "{name}" already exists.'
                )
        _projects_store[pid] = project
        _save_projects()

    return ProjectOut(**project)


@app.get("/api/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: str):
    with _projects_lock:
        p = _projects_store.get(project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        return ProjectOut(**p)


@app.patch("/api/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, payload: ProjectUpdate):
    with _projects_lock:
        p = _projects_store.get(project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")

        if payload.name is not None:
            n = payload.name.strip()
            if not n:
                raise HTTPException(status_code=400, detail="Project name cannot be empty.")
            # check duplicate
            for other_id, other in _projects_store.items():
                if other_id != project_id and other["name"].lower() == n.lower():
                    raise HTTPException(
                        status_code=409, detail=f'A project named "{n}" already exists.'
                    )
            p["name"] = n

        if payload.description is not None:
            p["description"] = payload.description.strip() or None

        if payload.chunk_strategy is not None:
            if payload.chunk_strategy and payload.chunk_strategy not in CHUNK_STRATEGIES:
                raise HTTPException(
                    status_code=400,
                    detail=f"chunk_strategy must be one of {sorted(CHUNK_STRATEGIES)}",
                )
            p["chunk_strategy"] = payload.chunk_strategy or None

        if payload.chunk_size is not None:
            if payload.chunk_size <= 0:
                raise HTTPException(status_code=400, detail="chunk_size must be > 0.")
            p["chunk_size"] = payload.chunk_size

        if payload.chunk_overlap is not None:
            if payload.chunk_overlap < 0:
                raise HTTPException(status_code=400, detail="chunk_overlap must be >= 0.")
            p["chunk_overlap"] = payload.chunk_overlap

        if payload.chunk_model is not None:
            p["chunk_model"] = payload.chunk_model.strip() or None

        p["updated_at"] = _now_iso()
        _projects_store[project_id] = p
        _save_projects()
        return ProjectOut(**p)


@app.post("/api/projects/{project_id}/touch", response_model=ProjectOut)
def touch_project(project_id: str):
    """Bump updated_at and increment file_count — kept for legacy Playground
    conversions that don't use the dedicated /files endpoint."""
    with _projects_lock:
        p = _projects_store.get(project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        p.setdefault("files", [])
        if p["files"]:
            # Detailed files already tracked — file_count is authoritative
            p["file_count"] = len(p["files"])
        else:
            p["file_count"] = int(p.get("file_count", 0)) + 1
        p["updated_at"] = _now_iso()
        _projects_store[project_id] = p
        _save_projects()
        return ProjectOut(**{k: v for k, v in p.items() if k in ProjectOut.model_fields})


# ---- Project files (many files per project) --------------------------------

@app.get("/api/projects/{project_id}/files", response_model=List[ProjectFileOut])
def list_project_files(project_id: str):
    with _projects_lock:
        p = _projects_store.get(project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        files = p.get("files", [])
        # newest first
        files_sorted = sorted(files, key=lambda x: x.get("created_at", ""), reverse=True)
        return [ProjectFileOut(**f) for f in files_sorted]


@app.post("/api/projects/{project_id}/files", response_model=List[ProjectFileOut])
async def upload_project_files(project_id: str, files: List[UploadFile] = File(...)):
    with _projects_lock:
        p = _projects_store.get(project_id)
        if not p:
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
            raise HTTPException(status_code=400, detail=f"File {upload.filename} is empty.")
        # 25 MB limit per file (backend also limited by proxy)
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"{upload.filename} exceeds 25 MB.")

        stream_info = StreamInfo(filename=upload.filename)
        try:
            result = _markitdown.convert_stream(io.BytesIO(data), stream_info=stream_info)
        except MarkItDownException as e:
            raise HTTPException(status_code=422, detail=f"{upload.filename}: {e}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"{upload.filename}: conversion failed: {e}")

        rec = {
            "id": uuid.uuid4().hex[:10],
            "filename": upload.filename,
            "title": result.title,
            "markdown": result.markdown,
            "created_at": _now_iso(),
            "chars": len(result.markdown),
        }
        new_records.append(rec)

    with _projects_lock:
        p = _projects_store.get(project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        p.setdefault("files", [])
        # prepend newest
        p["files"] = new_records + p["files"]
        p["file_count"] = len(p["files"])
        p["updated_at"] = _now_iso()
        _projects_store[project_id] = p
        _save_projects()
        return [ProjectFileOut(**r) for r in new_records]


@app.delete("/api/projects/{project_id}/files/{file_id}", status_code=204)
def delete_project_file(project_id: str, file_id: str):
    with _projects_lock:
        p = _projects_store.get(project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        files = p.get("files", [])
        orig_len = len(files)
        p["files"] = [f for f in files if f.get("id") != file_id]
        if len(p["files"]) == orig_len:
            raise HTTPException(status_code=404, detail="File not found.")
        p["file_count"] = len(p["files"])
        p["updated_at"] = _now_iso()
        _projects_store[project_id] = p
        _save_projects()
    return None


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str):
    with _projects_lock:
        if project_id not in _projects_store:
            raise HTTPException(status_code=404, detail="Project not found.")
        del _projects_store[project_id]
        _save_projects()
    return None
