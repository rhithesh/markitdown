# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT
import re
import sys
from typing import Callable, List, Optional, Sequence

from .._exceptions import MissingDependencyException
from .._page_markers import page_at_offset, strip_page_markers
from ._base import BaseChunker, Chunk
from ._preprocessing import normalize_whitespace

_sentence_transformers_exc_info = None
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    _sentence_transformers_exc_info = sys.exc_info()

_MISSING_EMBEDDING_MESSAGE = (
    "SemanticChunker requires an embedding_function. Either pass one "
    "explicitly -- any callable mapping List[str] -> a sequence of "
    "embedding vectors, e.g. an OpenAI embeddings client wrapper or a "
    "chromadb EmbeddingFunction -- or install the optional "
    "'sentence-transformers' dependency to use the default local model:\n\n"
    "  pip install 'markitdown[semantic-chunking]'\n"
    "  pip install sentence-transformers"
)

# Splits on sentence-ending punctuation followed by whitespace. Deliberately
# simpler than a full sentence tokenizer (e.g. nltk/spacy) -- good enough for
# breakpoint detection, and keeps this chunker dependency-light.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.?!])\s+")

EmbeddingFunction = Callable[[List[str]], Sequence[Sequence[float]]]


def _default_embedding_function() -> EmbeddingFunction:
    if _sentence_transformers_exc_info is not None:
        raise MissingDependencyException(
            _MISSING_EMBEDDING_MESSAGE
        ) from _sentence_transformers_exc_info[
            1
        ].with_traceback(  # type: ignore[union-attr]
            _sentence_transformers_exc_info[2]
        )

    model = SentenceTransformer("all-MiniLM-L6-v2")
    return lambda texts: model.encode(texts, show_progress_bar=False)


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


def _combine_with_buffer(sentences: List[str], buffer_size: int) -> List[str]:
    """
    Combine each sentence with `buffer_size` neighboring sentences on each
    side before embedding, so a single short sentence ("Yes.") doesn't get
    an embedding based on almost no context.
    """
    combined = []
    for i in range(len(sentences)):
        start = max(0, i - buffer_size)
        end = min(len(sentences), i + buffer_size + 1)
        combined.append(" ".join(sentences[start:end]))
    return combined


class SemanticChunker(BaseChunker):
    """
    Semantic chunking, using Chroma's target-size-aware modification of Greg
    Kamradt's original method (see https://research.trychroma.com/evaluating-chunking).

    Kamradt's original approach embeds each sentence (combined with
    neighboring sentences for local context via `buffer_size`), measures the
    cosine distance between consecutive sentence embeddings, and cuts
    wherever that distance exceeds a fixed percentile of the overall
    distance distribution -- i.e. wherever the topic shifts more than usual.
    A *fixed* percentile threshold can produce wildly uneven chunk sizes:
    tiny chunks in topic-dense sections, huge ones in uniform sections.

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
    ):
        if target_chunk_size <= 0:
            raise ValueError("target_chunk_size must be greater than 0")
        if buffer_size < 0:
            raise ValueError("buffer_size must be >= 0")
        if not (0 <= min_percentile < max_percentile <= 100):
            raise ValueError(
                "require 0 <= min_percentile < max_percentile <= 100"
            )
        if not (0 < tolerance < 1):
            raise ValueError("tolerance must be between 0 and 1")

        self.embedding_function = embedding_function or _default_embedding_function()
        self.target_chunk_size = target_chunk_size
        self.length_function = length_function
        self.buffer_size = buffer_size
        self.min_percentile = min_percentile
        self.max_percentile = max_percentile
        self.max_iterations = max_iterations
        self.tolerance = tolerance

    def chunk(self, text: str, *, filename: Optional[str] = None) -> List[Chunk]:
        normalized = normalize_whitespace(text)
        clean_text, breakpoints = strip_page_markers(normalized)
        if not clean_text.strip():
            return []

        sentences = _split_sentences(clean_text)
        if len(sentences) <= 1:
            chunk_texts = [clean_text.strip()] if clean_text.strip() else []
        else:
            distances = self._distances(sentences)
            chunk_texts = self._binary_search_chunks(sentences, distances)

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

    def _distances(self, sentences: List[str]) -> List[float]:
        combined = _combine_with_buffer(sentences, self.buffer_size)
        embeddings = self.embedding_function(combined)
        return [
            _cosine_distance(embeddings[i], embeddings[i + 1])
            for i in range(len(embeddings) - 1)
        ]

    def _chunks_at_percentile(
        self, sentences: List[str], distances: List[float], percentile: float
    ) -> List[str]:
        threshold = _percentile(distances, percentile)
        chunks: List[str] = []
        current = [sentences[0]]
        for i, distance in enumerate(distances):
            if distance > threshold:
                chunks.append(" ".join(current))
                current = []
            current.append(sentences[i + 1])
        if current:
            chunks.append(" ".join(current))
        return chunks

    def _average_size(self, chunks: List[str]) -> float:
        if not chunks:
            return 0.0
        return sum(self.length_function(c) for c in chunks) / len(chunks)

    def _binary_search_chunks(
        self, sentences: List[str], distances: List[float]
    ) -> List[str]:
        low, high = self.min_percentile, self.max_percentile
        best_chunks = self._chunks_at_percentile(sentences, distances, high)
        best_diff = abs(self._average_size(best_chunks) - self.target_chunk_size)

        for _ in range(self.max_iterations):
            mid = (low + high) / 2
            candidate = self._chunks_at_percentile(sentences, distances, mid)
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
                # sentence-pairs count as topic shifts).
                low = mid
            else:
                # Chunks came out too big -> need more breakpoints -> lower
                # the threshold.
                high = mid

        return best_chunks
