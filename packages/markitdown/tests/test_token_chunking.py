#!/usr/bin/env python3 -m pytest
import os

import pytest
import tiktoken

from markitdown import MarkItDownException, TokenChunker

# This file tests the TokenChunker in isolation, using plain strings rather
# than real documents. Tests that resolve a tokenizer via tiktoken run
# offline (tiktoken's encoding files are small and cached after first use).
# Tests that need to fall back to HuggingFace involve a real network call
# and download, so they're skipped in CI, matching this repo's convention
# for other network-dependent tests (see test_module_misc.py's skip_remote).
skip_remote = True if os.environ.get("GITHUB_ACTIONS") else False


def test_default_uses_cl100k_base_with_no_model():
    chunker = TokenChunker(chunk_size=10, chunk_overlap=0)

    assert chunker.model is None
    assert chunker.encoding_name == "cl100k_base"


TEXT = "The quick brown fox jumps over the lazy dog while thinking about tokenization boundaries carefully."


def _expected_chunk_texts(text, chunk_size, chunk_overlap):
    """
    Mirrors the sliding-window algorithm documented in TokenChunker's
    docstring, computed directly against tiktoken -- used to derive correct
    expected values instead of hand-typing (and potentially mistyping)
    literal strings.
    """
    encoding = tiktoken.get_encoding("cl100k_base")
    tokens = encoding.encode(text)
    step = chunk_size - chunk_overlap
    texts = []
    start = 0
    while start < len(tokens):
        end = min(start + chunk_size, len(tokens))
        texts.append(encoding.decode(tokens[start:end]))
        start += step
    return texts


def test_no_overlap_exact_boundaries():
    chunker = TokenChunker(chunk_size=8, chunk_overlap=0)
    chunks = chunker.chunk(TEXT, filename="test.txt")

    assert [c.text for c in chunks] == _expected_chunk_texts(TEXT, 8, 0)


def test_overlap_slides_by_size_minus_overlap():
    chunker = TokenChunker(chunk_size=8, chunk_overlap=3)
    chunks = chunker.chunk(TEXT, filename="test.txt")

    assert [c.text for c in chunks] == _expected_chunk_texts(TEXT, 8, 3)


def test_empty_text_returns_no_chunks():
    chunker = TokenChunker(chunk_size=10, chunk_overlap=0)
    assert chunker.chunk("", filename="test.txt") == []


def test_text_shorter_than_chunk_size_returns_single_chunk():
    chunker = TokenChunker(chunk_size=1000, chunk_overlap=200)
    chunks = chunker.chunk("short text", filename="test.txt")

    assert len(chunks) == 1
    assert chunks[0].text == "short text"


def test_token_count_metadata():
    chunker = TokenChunker(chunk_size=8, chunk_overlap=0)
    chunks = chunker.chunk(TEXT, filename="test.txt")

    # Every chunk but the last should be exactly chunk_size tokens.
    for chunk in chunks[:-1]:
        assert chunk.metadata["token_count"] == 8
    assert chunks[-1].metadata["token_count"] <= 8


def test_metadata_fields():
    chunker = TokenChunker(chunk_size=8, chunk_overlap=0)
    chunks = chunker.chunk(TEXT, filename="test.txt")

    for index, chunk in enumerate(chunks):
        assert chunk.metadata["filename"] == "test.txt"
        assert chunk.metadata["chunk_index"] == index
        assert chunk.metadata["total_chunks"] == len(chunks)


def test_page_no_none_when_no_markers():
    chunker = TokenChunker(chunk_size=10, chunk_overlap=0)
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")

    assert all(c.metadata["page_no"] is None for c in chunks)


def test_page_markers_are_stripped_and_attributed():
    text = "<!-- Page number: 1 -->\nAAAAAAAAAA\n" "<!-- Page number: 2 -->\nBBBBBBBBBB"
    chunker = TokenChunker(chunk_size=4, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.pdf")

    assert all("Page number" not in c.text for c in chunks)
    assert [c.text for c in chunks] == ["AAAAAAAAAA\nBBBB", "BBBBBB"]
    assert [c.metadata["page_no"] for c in chunks] == [1, 2]


def test_whitespace_normalization_collapses_tabs_and_spaces():
    chunker = TokenChunker(chunk_size=100, chunk_overlap=0)
    chunks = chunker.chunk("AN\tIMPRINT\tOF\tPENGUIN", filename="test.pdf")

    assert chunks[0].text == "AN IMPRINT OF PENGUIN"


def test_whitespace_normalization_caps_blank_lines():
    chunker = TokenChunker(chunk_size=100, chunk_overlap=0)
    chunks = chunker.chunk("first\n\n\n\n\nsecond", filename="test.txt")

    assert chunks[0].text == "first\n\nsecond"


def test_openai_model_name_resolves_via_tiktoken():
    # "gpt-4o" is recognized by tiktoken directly, so this must resolve
    # offline (no HuggingFace / network involved).
    chunker = TokenChunker(chunk_size=10, chunk_overlap=0, model="gpt-4o")

    assert type(chunker._backend).__name__ == "_TiktokenBackend"
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")
    assert len(chunks) > 0


def test_encoding_name_is_used_when_model_not_given():
    chunker = TokenChunker(chunk_size=10, chunk_overlap=0, encoding_name="o200k_base")

    assert type(chunker._backend).__name__ == "_TiktokenBackend"
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")
    assert len(chunks) > 0


@pytest.mark.parametrize(
    "chunk_size,chunk_overlap",
    [
        (0, 0),
        (-1, 0),
        (10, -1),
        (10, 10),
        (10, 11),
    ],
)
def test_invalid_size_or_overlap_raises(chunk_size, chunk_overlap):
    with pytest.raises(ValueError):
        TokenChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)


@pytest.mark.skipif(
    skip_remote,
    reason="requires downloading a real tokenizer from HuggingFace",
)
def test_non_openai_model_name_falls_back_to_huggingface():
    chunker = TokenChunker(chunk_size=10, chunk_overlap=0, model="bert-base-uncased")

    assert type(chunker._backend).__name__ == "_HuggingFaceBackend"
    chunks = chunker.chunk("Hello world, this is a test.", filename="test.txt")
    assert len(chunks) > 0


@pytest.mark.skipif(
    skip_remote,
    reason="requires a network call to HuggingFace to confirm the model doesn't exist",
)
def test_unresolvable_model_name_raises_clear_error():
    with pytest.raises(MarkItDownException, match="this-model-does-not-exist"):
        TokenChunker(
            chunk_size=10, chunk_overlap=0, model="this-model-does-not-exist-xyz"
        )
