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
from pydantic import BaseModel

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


class ChunkOut(BaseModel):
    text: str
    metadata: dict


class ConvertResponse(BaseModel):
    filename: str
    title: Optional[str] = None
    markdown: str
    chunks: Optional[List[ChunkOut]] = None


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
