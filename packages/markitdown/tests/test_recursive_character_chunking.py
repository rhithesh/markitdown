#!/usr/bin/env python3 -m pytest
import pytest

from markitdown import RecursiveCharacterChunker

# This file tests RecursiveCharacterChunker in isolation, using plain
# strings rather than real documents -- chunking has no knowledge of the
# file format it came from.


def test_merges_paragraphs_that_fit_within_chunk_size():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunker = RecursiveCharacterChunker(chunk_size=100, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.txt")

    # All three paragraphs fit comfortably in one 100-char chunk, so they
    # should be merged back together rather than split unnecessarily.
    assert len(chunks) == 1
    assert chunks[0].text == text


def test_splits_on_paragraph_breaks_when_too_big_to_merge():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunker = RecursiveCharacterChunker(chunk_size=20, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.txt")

    assert [c.text for c in chunks] == [
        "Paragraph one.",
        "Paragraph two.",
        "Paragraph three.",
    ]


def test_no_chunk_ever_exceeds_chunk_size():
    # A real, messy paragraph with no convenient natural breaks near the
    # limit, to exercise the fallback through multiple separator tiers.
    text = (
        "This is sentence one here. This is sentence two here. "
        "This is sentence three here. This is sentence four here. "
        "This is sentence five here without a natural break nearby."
    )
    for chunk_size, chunk_overlap in [(20, 0), (30, 5), (50, 10), (15, 3)]:
        chunker = RecursiveCharacterChunker(
            chunk_size=chunk_size, chunk_overlap=chunk_overlap
        )
        chunks = chunker.chunk(text, filename="test.txt")
        assert all(len(c.text) <= chunk_size for c in chunks), (
            chunk_size,
            chunk_overlap,
        )


def test_falls_back_to_sentence_boundaries():
    text = "This is sentence one here. This is sentence two here. This is sentence three here. This is sentence four here."
    chunker = RecursiveCharacterChunker(chunk_size=30, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.txt")

    assert [c.text for c in chunks] == [
        "This is sentence one here",
        "This is sentence two here",
        "This is sentence three here",
        "This is sentence four here",
    ]


def test_falls_back_to_comma_and_semicolon_boundaries():
    text = (
        "First clause here, second clause here; third clause here, fourth clause here"
    )
    chunker = RecursiveCharacterChunker(chunk_size=25, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.txt")

    assert [c.text for c in chunks] == [
        "First clause here",
        "second clause here",
        "third clause here",
        "fourth clause here",
    ]


def test_falls_back_to_raw_characters_as_last_resort():
    # No spaces, no punctuation, no newlines -- nothing to split on but
    # individual characters.
    text = "a" * 50
    chunker = RecursiveCharacterChunker(chunk_size=10, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.txt")

    assert [c.text for c in chunks] == ["a" * 10] * 5


def test_overlap_shares_content_when_there_is_room():
    text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"
    chunker = RecursiveCharacterChunker(chunk_size=30, chunk_overlap=10)
    chunks = chunker.chunk(text, filename="test.txt")

    assert [c.text for c in chunks] == [
        "one two three four five six",
        "five six seven eight nine ten",
        "nine ten eleven twelve",
        "twelve thirteen fourteen",
        "fourteen fifteen sixteen",
    ]
    # Every consecutive pair shares at least one word of overlap.
    for prev, nxt in zip(chunks, chunks[1:]):
        assert set(prev.text.split(" ")) & set(nxt.text.split(" "))


def test_empty_text_returns_no_chunks():
    chunker = RecursiveCharacterChunker(chunk_size=10, chunk_overlap=0)
    assert chunker.chunk("", filename="test.txt") == []


def test_text_shorter_than_chunk_size_returns_single_chunk():
    chunker = RecursiveCharacterChunker(chunk_size=1000, chunk_overlap=200)
    chunks = chunker.chunk("short text", filename="test.txt")

    assert len(chunks) == 1
    assert chunks[0].text == "short text"


def test_metadata_fields():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunker = RecursiveCharacterChunker(chunk_size=20, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.txt")

    assert len(chunks) == 3
    for index, chunk in enumerate(chunks):
        assert chunk.metadata["filename"] == "test.txt"
        assert chunk.metadata["chunk_index"] == index
        assert chunk.metadata["total_chunks"] == 3


def test_page_no_none_when_no_markers():
    chunker = RecursiveCharacterChunker(chunk_size=20, chunk_overlap=0)
    chunks = chunker.chunk("Paragraph one.\n\nParagraph two.", filename="test.txt")

    assert all(c.metadata["page_no"] is None for c in chunks)


def test_page_markers_are_stripped_and_attributed():
    text = (
        "<!-- Page number: 1 -->\nParagraph one is here now.\n\n"
        "<!-- Page number: 2 -->\nParagraph two is here now."
    )
    chunker = RecursiveCharacterChunker(chunk_size=30, chunk_overlap=0)
    chunks = chunker.chunk(text, filename="test.pdf")

    assert all("Page number" not in c.text for c in chunks)
    assert [c.text for c in chunks] == [
        "Paragraph one is here now.",
        "Paragraph two is here now.",
    ]
    assert [c.metadata["page_no"] for c in chunks] == [1, 2]


def test_whitespace_normalization_collapses_tabs_and_spaces():
    chunker = RecursiveCharacterChunker(chunk_size=100, chunk_overlap=0)
    chunks = chunker.chunk("AN\tIMPRINT\tOF\tPENGUIN", filename="test.pdf")

    assert chunks[0].text == "AN IMPRINT OF PENGUIN"


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
        RecursiveCharacterChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
