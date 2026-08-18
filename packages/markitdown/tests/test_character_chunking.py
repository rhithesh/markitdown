#!/usr/bin/env python3 -m pytest
import pytest

from markitdown import CharacterChunker

# This file tests the CharacterChunker in isolation, using plain strings
# rather than real documents -- chunking has no knowledge of the file format
# it came from, so there's no need to exercise it through a PDF/DOCX/etc.


def test_no_overlap_exact_boundaries():
    chunker = CharacterChunker(chunk_size=10, chunk_overlap=0)
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")

    assert [c.text for c in chunks] == ["The quick ", "brown fox ", "jumps"]


def test_overlap_slides_by_size_minus_overlap():
    chunker = CharacterChunker(chunk_size=10, chunk_overlap=3)
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")

    assert [c.text for c in chunks] == [
        "The quick ",
        "ck brown f",
        "n fox jump",
        "umps",
    ]


def test_overlap_tail_matches_next_head():
    chunker = CharacterChunker(chunk_size=10, chunk_overlap=3)
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")

    for prev, nxt in zip(chunks, chunks[1:]):
        assert prev.text[-3:] == nxt.text[:3]


def test_empty_text_returns_no_chunks():
    chunker = CharacterChunker(chunk_size=10, chunk_overlap=0)
    assert chunker.chunk("", filename="test.txt") == []


def test_text_shorter_than_chunk_size_returns_single_chunk():
    chunker = CharacterChunker(chunk_size=1000, chunk_overlap=200)
    chunks = chunker.chunk("short text", filename="test.txt")

    assert len(chunks) == 1
    assert chunks[0].text == "short text"


def test_last_chunk_is_not_padded():
    chunker = CharacterChunker(chunk_size=10, chunk_overlap=0)
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")

    assert chunks[-1].text == "jumps"
    assert len(chunks[-1].text) < 10


def test_metadata_fields():
    chunker = CharacterChunker(chunk_size=10, chunk_overlap=0)
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")

    assert len(chunks) == 3
    for index, chunk in enumerate(chunks):
        assert chunk.metadata["filename"] == "test.txt"
        assert chunk.metadata["chunk_index"] == index
        assert chunk.metadata["total_chunks"] == 3


def test_page_no_none_when_no_markers():
    chunker = CharacterChunker(chunk_size=10, chunk_overlap=0)
    chunks = chunker.chunk("The quick brown fox jumps", filename="test.txt")

    assert all(c.metadata["page_no"] is None for c in chunks)


def test_page_markers_are_stripped_and_attributed():
    text = "<!-- Page number: 1 -->\nAAAAAAAAAA\n" "<!-- Page number: 2 -->\nBBBBBBBBBB"
    chunker = CharacterChunker(chunk_size=8, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.pdf")

    # Markers themselves must never leak into chunk text.
    assert all("Page number" not in c.text for c in chunks)
    assert [c.text for c in chunks] == ["AAAAAAAA", "AA\nBBBBB", "BBBBB"]
    assert [c.metadata["page_no"] for c in chunks] == [1, 1, 2]


def test_slide_markers_are_recognized_like_page_markers():
    text = "<!-- Slide number: 1 -->\nHello world"
    chunker = CharacterChunker(chunk_size=100, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.pptx")

    assert chunks[0].text == "Hello world"
    assert chunks[0].metadata["page_no"] == 1


def test_whitespace_normalization_collapses_tabs_and_spaces():
    chunker = CharacterChunker(chunk_size=100, chunk_overlap=0)
    chunks = chunker.chunk("AN\tIMPRINT\tOF\tPENGUIN", filename="test.pdf")

    assert chunks[0].text == "AN IMPRINT OF PENGUIN"


def test_whitespace_normalization_caps_blank_lines():
    chunker = CharacterChunker(chunk_size=100, chunk_overlap=0)
    chunks = chunker.chunk("first\n\n\n\n\nsecond", filename="test.txt")

    assert chunks[0].text == "first\n\nsecond"


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
        CharacterChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
