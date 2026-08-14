# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT
import sys
from typing import Any, List, Optional, Protocol, Tuple

from .._exceptions import MarkItDownException, MissingDependencyException
from .._page_markers import page_at_offset, strip_page_markers
from ._base import BaseChunker, Chunk
from ._preprocessing import normalize_whitespace

_tiktoken_exc_info = None
try:
    import tiktoken
except ImportError:
    _tiktoken_exc_info = sys.exc_info()

_transformers_exc_info = None
try:
    import transformers
except ImportError:
    _transformers_exc_info = sys.exc_info()

_MISSING_TIKTOKEN_MESSAGE = (
    "TokenChunker requires the 'tiktoken' package, which is not installed. "
    "To resolve this, install the optional dependency:\n\n"
    "  pip install 'markitdown[chunking]'\n"
    "  pip install 'markitdown[all]'\n"
    "  pip install tiktoken"
)

_MISSING_TRANSFORMERS_MESSAGE = (
    "model={model!r} is not an OpenAI model tiktoken recognizes, so it needs to be "
    "loaded from HuggingFace instead -- that requires the 'transformers' package, "
    "which is not installed. To resolve this, install the optional dependency:\n\n"
    "  pip install 'markitdown[chunking]'\n"
    "  pip install 'markitdown[all]'\n"
    "  pip install transformers"
)


class _TokenizerBackend(Protocol):
    def encode(self, text: str) -> List[int]:
        ...

    def decode(self, tokens: List[int]) -> str:
        ...


class _TiktokenBackend:
    def __init__(self, encoding: "tiktoken.Encoding"):
        self._encoding = encoding

    def encode(self, text: str) -> List[int]:
        return self._encoding.encode(text)

    def decode(self, tokens: List[int]) -> str:
        return self._encoding.decode(tokens)


class _HuggingFaceBackend:
    def __init__(self, tokenizer: Any):
        self._tokenizer = tokenizer

    def encode(self, text: str) -> List[int]:
        return self._tokenizer.encode(text, add_special_tokens=False)

    def decode(self, tokens: List[int]) -> str:
        return self._tokenizer.decode(tokens, skip_special_tokens=True)


def _resolve_backend(model: Optional[str], encoding_name: str) -> _TokenizerBackend:
    if _tiktoken_exc_info is not None:
        raise MissingDependencyException(
            _MISSING_TIKTOKEN_MESSAGE
        ) from _tiktoken_exc_info[
            1
        ].with_traceback(  # type: ignore[union-attr]
            _tiktoken_exc_info[2]
        )

    if model is None:
        return _TiktokenBackend(tiktoken.get_encoding(encoding_name))

    # Try the OpenAI family first (fully offline, no extra dependency).
    try:
        return _TiktokenBackend(tiktoken.encoding_for_model(model))
    except KeyError:
        pass

    # Fall back to HuggingFace for open models (Llama, Mistral, etc.). This
    # downloads and caches the model's real tokenizer on first use, and may
    # require a HuggingFace token for gated repos.
    if _transformers_exc_info is not None:
        raise MissingDependencyException(
            _MISSING_TRANSFORMERS_MESSAGE.format(model=model)
        ) from _transformers_exc_info[
            1
        ].with_traceback(  # type: ignore[union-attr]
            _transformers_exc_info[2]
        )

    try:
        tokenizer = transformers.AutoTokenizer.from_pretrained(model)
    except Exception as e:
        raise MarkItDownException(
            f"Could not resolve a tokenizer for model={model!r}. It isn't an "
            "OpenAI model tiktoken recognizes, and loading it from HuggingFace "
            "failed. If this is a gated model, make sure you're authenticated "
            "(e.g. `huggingface-cli login` or the HF_TOKEN env var); otherwise "
            "double check the model name."
        ) from e

    return _HuggingFaceBackend(tokenizer)


class TokenChunker(BaseChunker):
    """
    Token-based chunking.

    Splits text into windows of `chunk_size` tokens, sliding forward by
    (chunk_size - chunk_overlap) tokens each step. This matches how language
    models actually consume text, rather than splitting on raw character
    counts.

    The tokenizer used depends on `model`:
    - None (default): uses `encoding_name` directly via tiktoken.
    - An OpenAI model name (e.g. "gpt-4o", "gpt-4"): resolved to the matching
      tiktoken encoding automatically.
    - Any other model name (e.g. "meta-llama/Llama-3.1-8B"): loaded from
      HuggingFace via `transformers.AutoTokenizer`, requiring the optional
      'transformers' dependency and, for gated models, HuggingFace auth.
    """

    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        model: Optional[str] = None,
        encoding_name: str = "cl100k_base",
    ):
        if chunk_size <= 0:
            raise ValueError("chunk_size must be greater than 0")
        if chunk_overlap < 0:
            raise ValueError("chunk_overlap must be >= 0")
        if chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")

        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.model = model
        self.encoding_name = encoding_name
        self._backend = _resolve_backend(model, encoding_name)

    def chunk(self, text: str, *, filename: Optional[str] = None) -> List[Chunk]:
        # Normalize whitespace *before* stripping markers, so the offsets
        # recorded in `breakpoints` line up with the final, tokenized text.
        normalized = normalize_whitespace(text)
        clean_text, breakpoints = strip_page_markers(normalized)
        if not clean_text:
            return []

        tokens = self._backend.encode(clean_text)
        step = self.chunk_size - self.chunk_overlap

        raw_chunks: List[Tuple[str, int, int]] = []  # (text, char_offset, token_count)
        start = 0
        token_len = len(tokens)
        while start < token_len:
            end = min(start + self.chunk_size, token_len)
            chunk_tokens = tokens[start:end]
            chunk_text = self._backend.decode(chunk_tokens)
            # Character offset of this chunk's start, derived by decoding
            # everything before it -- tells us which page it falls on.
            char_offset = len(self._backend.decode(tokens[:start]))
            raw_chunks.append((chunk_text, char_offset, len(chunk_tokens)))
            start += step

        total = len(raw_chunks)
        return [
            Chunk(
                text=chunk_text,
                metadata={
                    "filename": filename,
                    "chunk_index": index,
                    "total_chunks": total,
                    "page_no": page_at_offset(breakpoints, char_offset),
                    "token_count": token_count,
                },
            )
            for index, (chunk_text, char_offset, token_count) in enumerate(raw_chunks)
        ]
