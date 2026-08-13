# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT
import re
from typing import List, Optional, Tuple

from .._page_markers import page_at_offset, strip_page_markers
from ._base import BaseChunker, Chunk

# Collapse runs of spaces/tabs into a single space (PDF extraction sometimes
# emits literal tab characters between words instead of spaces).
_WHITESPACE_RUN_RE = re.compile(r"[ \t]+")
# Cap runs of 3+ newlines down to a single blank line.
_EXCESS_BLANK_LINES_RE = re.compile(r"\n{3,}")


def _normalize_whitespace(text: str) -> str:
    text = _WHITESPACE_RUN_RE.sub(" ", text)
    text = _EXCESS_BLANK_LINES_RE.sub("\n\n", text)
    return text


class CharacterChunker(BaseChunker):
    """
    Naive fixed-size character chunking.

    Splits text into windows of `chunk_size` characters, sliding forward by
    (chunk_size - chunk_overlap) characters each step. Cuts are strictly at
    the character boundary -- words and sentences may be split mid-way.
    """

    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200):
        if chunk_size <= 0:
            raise ValueError("chunk_size must be greater than 0")
        if chunk_overlap < 0:
            raise ValueError("chunk_overlap must be >= 0")
        if chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")

        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk(self, text: str, *, filename: Optional[str] = None) -> List[Chunk]:
        # Normalize whitespace *before* stripping markers, so the offsets
        # recorded in `breakpoints` line up with the final, sliced text.
        normalized = _normalize_whitespace(text)
        clean_text, breakpoints = strip_page_markers(normalized)
        if not clean_text:
            return []

        step = self.chunk_size - self.chunk_overlap
        raw_chunks: List[Tuple[str, int]] = []
        start = 0
        text_len = len(clean_text)
        while start < text_len:
            end = min(start + self.chunk_size, text_len)
            raw_chunks.append((clean_text[start:end], start))
            start += step

        total = len(raw_chunks)
        return [
            Chunk(
                text=chunk_text,
                metadata={
                    "filename": filename,
                    "chunk_index": index,
                    "total_chunks": total,
                    "page_no": page_at_offset(breakpoints, offset),
                },
            )
            for index, (chunk_text, offset) in enumerate(raw_chunks)
        ]
