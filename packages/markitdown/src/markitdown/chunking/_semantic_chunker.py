# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT
import re
from typing import Callable, List, Optional, Sequence

from .._page_markers import page_at_offset, strip_page_markers
from ._base import BaseChunker, Chunk
from ._preprocessing import normalize_whitespace

_MISSING_EMBEDDING_MESSAGE = (
    "SemanticChunker requires an embedding_function -- there is no default "
    "embedding model, so nothing is ever downloaded automatically. Pass any "
    "callable mapping List[str] -> a sequence of embedding vectors, e.g. an "
    "OpenAI embeddings client wrapper, a chromadb EmbeddingFunction, or a "
    "sentence-transformers model.encode call."
)

# Splits on blank lines -- paragraphs are the base unit for embedding (see
# SemanticChunker docstring for why). Matches the paragraph tier of
# RecursiveCharacterChunker's DEFAULT_SEPARATORS, so both chunkers agree on
# what a "paragraph" is.
_PARAGRAPH_SPLIT_RE = re.compile(r"\n\s*\n+")

# Falls back to sentence-level splitting only for paragraphs so large they'd
# otherwise become one unsplittable, oversized unit.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.?!])\s+")

# A paragraph larger than this multiple of target_chunk_size gets pre-split
# into sentences before embedding, so one huge paragraph can't single-handedly
# blow past the target -- see the _split_paragraphs docstring.
_OVERSIZE_PARAGRAPH_MULTIPLE = 3

EmbeddingFunction = Callable[[List[str]], Sequence[Sequence[float]]]


def _cosine_distance(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 1.0
    return 1.0 - dot / (norm_a * norm_b)


def _percentile(values: List[float], pct: float) -> float:
    """Linear-interpolation percentile, avoiding a hard numpy dependency."""
    sorted_vals = sorted(values)
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (pct / 100)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def _split_sentences(text: str) -> List[str]:
    return [s for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]


def _split_paragraphs(text: str, target_chunk_size: int) -> List[str]:
    """
    Split into paragraphs (blank-line-separated blocks) -- the base semantic
    unit. Paragraphs are a much stronger topic-coherence signal than raw
    sentences: a paragraph almost never straddles two different topics, so
    the boundary *between* two paragraphs is a meaningful place to look for
    a topic shift, whereas the boundary between two arbitrary sentences
    often isn't. A single-line heading also naturally becomes its own
    paragraph (surrounded by blank lines), so it's compared as a distinct
    unit rather than getting smeared into a multi-sentence buffer window.

    Any paragraph larger than `_OVERSIZE_PARAGRAPH_MULTIPLE * target_chunk_size`
    is pre-split into sentences, so one abnormally large paragraph (a wall of
    text with no blank-line breaks) can't become one unsplittable, oversized
    unit that defeats the whole target_chunk_size mechanism.
    """
    units: List[str] = []
    for paragraph in _PARAGRAPH_SPLIT_RE.split(text):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) > _OVERSIZE_PARAGRAPH_MULTIPLE * target_chunk_size:
            units.extend(_split_sentences(paragraph))
        else:
            units.append(paragraph)
    return units


def _combine_with_buffer(
    units: List[str], buffer_size: int, separator: str
) -> List[str]:
    """
    Combine each unit with `buffer_size` neighboring units on each side
    before embedding, so a single short unit (a one-line heading, "Yes.")
    doesn't get an embedding based on almost no context.
    """
    combined = []
    for i in range(len(units)):
        start = max(0, i - buffer_size)
        end = min(len(units), i + buffer_size + 1)
        combined.append(separator.join(units[start:end]))
    return combined


class SemanticChunker(BaseChunker):
    """
    Semantic chunking, using Chroma's target-size-aware modification of Greg
    Kamradt's original method (see https://research.trychroma.com/evaluating-chunking).

    Kamradt's original approach embeds each unit of text (combined with
    neighboring units for local context via `buffer_size`), measures the
    cosine distance between consecutive unit embeddings, and cuts wherever
    that distance exceeds a fixed percentile of the overall distance
    distribution -- i.e. wherever the topic shifts more than usual. A
    *fixed* percentile threshold can produce wildly uneven chunk sizes:
    tiny chunks in topic-dense sections, huge ones in uniform sections.

    `unit` controls what "a unit of text" means, and it matters a lot in
    practice:
    - `"paragraph"` (default): paragraphs (blank-line-separated blocks) are
      a much stronger topic-coherence signal than raw sentences -- a
      paragraph almost never straddles two different topics, and a heading
      naturally becomes its own comparison unit since it sits alone between
      blank lines. Validated empirically to be substantially more accurate
      at finding real structural boundaries (e.g. chapter breaks) than
      sentence-level splitting. An abnormally large paragraph (no
      blank-line breaks) is pre-split into sentences so it can't
      single-handedly blow past `target_chunk_size`.
    - `"sentence"`: Kamradt's original granularity. Finer-grained control
      over chunk boundaries, at the cost of a noisier, weaker per-unit
      signal -- better suited to short documents or when you specifically
      want sentence-level split precision rather than paragraph-level.

    Chroma's modification keeps the same semantic-breakpoint idea, but
    binary-searches over the percentile threshold itself: it repeatedly
    re-cuts the text at different percentiles until the resulting chunks'
    average size converges on `target_chunk_size` (within `tolerance`).
    Splits still only ever happen at genuine semantic boundaries -- the
    search just finds *which* percentile of "genuine boundary" keeps the
    output close to a usable, predictable size for embedding models or LLM
    context windows.
    """

    def __init__(
        self,
        embedding_function: Optional[EmbeddingFunction] = None,
        target_chunk_size: int = 500,
        length_function: Callable[[str], int] = len,
        buffer_size: int = 1,
        min_percentile: float = 50.0,
        max_percentile: float = 99.0,
        max_iterations: int = 8,
        tolerance: float = 0.1,
        unit: str = "paragraph",
    ):
        if embedding_function is None:
            raise ValueError(_MISSING_EMBEDDING_MESSAGE)
        if target_chunk_size <= 0:
            raise ValueError("target_chunk_size must be greater than 0")
        if buffer_size < 0:
            raise ValueError("buffer_size must be >= 0")
        if not (0 <= min_percentile < max_percentile <= 100):
            raise ValueError("require 0 <= min_percentile < max_percentile <= 100")
        if not (0 < tolerance < 1):
            raise ValueError("tolerance must be between 0 and 1")
        if unit not in ("sentence", "paragraph"):
            raise ValueError('unit must be "sentence" or "paragraph"')

        self.embedding_function = embedding_function
        self.target_chunk_size = target_chunk_size
        self.length_function = length_function
        self.buffer_size = buffer_size
        self.min_percentile = min_percentile
        self.max_percentile = max_percentile
        self.max_iterations = max_iterations
        self.tolerance = tolerance
        self.unit = unit
        # Paragraphs are joined with a blank line to preserve their
        # structure in the output; sentences are joined with a space,
        # matching Kamradt's original approach.
        self._separator = "\n\n" if unit == "paragraph" else " "

    def chunk(self, text: str, *, filename: Optional[str] = None) -> List[Chunk]:
        normalized = normalize_whitespace(text)
        clean_text, breakpoints = strip_page_markers(normalized)
        if not clean_text.strip():
            return []

        if self.unit == "paragraph":
            units = _split_paragraphs(clean_text, self.target_chunk_size)
        else:
            units = _split_sentences(clean_text)
        if len(units) <= 1:
            chunk_texts = [clean_text.strip()] if clean_text.strip() else []
        else:
            distances = self._distances(units)
            chunk_texts = self._binary_search_chunks(units, distances)

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

    def _distances(self, units: List[str]) -> List[float]:
        combined = _combine_with_buffer(units, self.buffer_size, self._separator)
        embeddings = self.embedding_function(combined)
        return [
            _cosine_distance(embeddings[i], embeddings[i + 1])
            for i in range(len(embeddings) - 1)
        ]

    def _chunks_at_percentile(
        self, units: List[str], distances: List[float], percentile: float
    ) -> List[str]:
        threshold = _percentile(distances, percentile)
        chunks: List[str] = []
        current = [units[0]]
        for i, distance in enumerate(distances):
            if distance > threshold:
                chunks.append(self._separator.join(current))
                current = []
            current.append(units[i + 1])
        if current:
            chunks.append(self._separator.join(current))
        return chunks

    def _average_size(self, chunks: List[str]) -> float:
        if not chunks:
            return 0.0
        return sum(self.length_function(c) for c in chunks) / len(chunks)

    def _binary_search_chunks(
        self, units: List[str], distances: List[float]
    ) -> List[str]:
        low, high = self.min_percentile, self.max_percentile
        best_chunks = self._chunks_at_percentile(units, distances, high)
        best_diff = abs(self._average_size(best_chunks) - self.target_chunk_size)

        for _ in range(self.max_iterations):
            mid = (low + high) / 2
            candidate = self._chunks_at_percentile(units, distances, mid)
            avg_size = self._average_size(candidate)
            diff = abs(avg_size - self.target_chunk_size)

            if diff < best_diff:
                best_chunks, best_diff = candidate, diff
            if best_diff <= self.tolerance * self.target_chunk_size:
                break

            if avg_size < self.target_chunk_size:
                # Chunks came out too small -> need fewer breakpoints ->
                # raise the threshold (a higher percentile of the distance
                # distribution means fewer distances exceed it, so fewer
                # paragraph-pairs count as topic shifts).
                low = mid
            else:
                # Chunks came out too big -> need more breakpoints -> lower
                # the threshold.
                high = mid

        return best_chunks
