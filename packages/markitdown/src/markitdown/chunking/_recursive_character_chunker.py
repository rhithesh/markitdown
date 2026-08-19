# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT
from typing import List, Optional

from .._page_markers import page_at_offset, strip_page_markers
from ._base import BaseChunker, Chunk
from ._preprocessing import normalize_whitespace

# Matches the widely-used LangChain default, as adjusted by Chroma's chunking
# research (https://research.trychroma.com/evaluating-chunking): sentence
# punctuation gets its own tier rather than a full "sentence boundary" regex,
# and "" (individual characters) is always last, guaranteeing termination.
DEFAULT_SEPARATORS = ["\n\n", "\n", ".", "?", "!", " ", ""]


def _merge_splits(
    splits: List[str], separator: str, chunk_size: int, chunk_overlap: int
) -> List[str]:
    """
    Greedily pack `splits` (all already under chunk_size individually) back
    together with `separator`, up to chunk_size characters per chunk.
    Trailing pieces are carried into the next chunk to satisfy chunk_overlap.
    """
    chunks: List[str] = []
    current: List[str] = []

    for piece in splits:
        if piece == "":
            continue
        candidate = current + [piece]
        if current and len(separator.join(candidate)) > chunk_size:
            chunks.append(separator.join(current))
            # Drop from the front until what remains both fits the overlap
            # budget *and* leaves room for `piece` within chunk_size --
            # checking only the overlap budget could still let the
            # retained tail + piece exceed chunk_size.
            while current and (
                len(separator.join(current)) > chunk_overlap
                or len(separator.join(current + [piece])) > chunk_size
            ):
                current.pop(0)
            candidate = current + [piece]
        current = candidate

    if current:
        chunks.append(separator.join(current))
    return chunks


def _split_text(
    text: str, separators: List[str], chunk_size: int, chunk_overlap: int
) -> List[str]:
    """
    Recursively split `text`, trying each separator in `separators` in
    order and falling back to the next one only for pieces still over
    chunk_size. Pieces that already fit get merged back up to chunk_size.
    """
    separator = separators[-1]
    next_separators: List[str] = []
    for index, sep in enumerate(separators):
        if sep == "":
            separator = sep
            break
        if sep in text:
            separator = sep
            next_separators = separators[index + 1 :]
            break

    splits = list(text) if separator == "" else text.split(separator)

    good_splits: List[str] = []
    result: List[str] = []
    for split in splits:
        if len(split) < chunk_size:
            good_splits.append(split)
            continue
        if good_splits:
            result.extend(
                _merge_splits(good_splits, separator, chunk_size, chunk_overlap)
            )
            good_splits = []
        if not next_separators:
            result.append(split)
        else:
            result.extend(
                _split_text(split, next_separators, chunk_size, chunk_overlap)
            )

    if good_splits:
        result.extend(_merge_splits(good_splits, separator, chunk_size, chunk_overlap))

    return result


class RecursiveCharacterChunker(BaseChunker):
    """
    Recursive character-based chunking.

    Tries to split on the most natural boundary first (paragraph breaks),
    falling back to progressively less natural ones (lines, sentences,
    words, then raw characters) only for pieces that are still over
    chunk_size. Prefers structural boundaries over CharacterChunker's
    strict character-count cuts, while still respecting chunk_size.
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
        self.separators = list(DEFAULT_SEPARATORS)

    def chunk(self, text: str, *, filename: Optional[str] = None) -> List[Chunk]:
        normalized = normalize_whitespace(text)
        clean_text, breakpoints = strip_page_markers(normalized)
        if not clean_text:
            return []

        chunk_texts = [
            c.strip()
            for c in _split_text(
                clean_text, self.separators, self.chunk_size, self.chunk_overlap
            )
            if c.strip()
        ]

        total = len(chunk_texts)
        chunks: List[Chunk] = []
        search_from = 0
        for index, chunk_text in enumerate(chunk_texts):
            offset = clean_text.find(chunk_text, search_from)
            if offset == -1:
                offset = search_from
            search_from = offset
            chunks.append(
                Chunk(
                    text=chunk_text,
                    metadata={
                        "filename": filename,
                        "chunk_index": index,
                        "total_chunks": total,
                        "page_no": page_at_offset(breakpoints, offset),
                    },
                )
            )
        return chunks
