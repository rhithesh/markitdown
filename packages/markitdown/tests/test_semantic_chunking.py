#!/usr/bin/env python3 -m pytest
import pytest

from markitdown import SemanticChunker

# This file tests SemanticChunker in isolation, using plain strings and a
# deterministic fake embedding_function -- SemanticChunker has no default
# embedding model (embedding_function is required), so tests instead supply
# a small callable that maps each combined-paragraph string to a one-hot
# "topic" vector. Paragraphs (blank-line-separated blocks) are the chunker's
# base unit -- paragraphs from the same topic get identical embeddings
# (cosine distance 0); paragraphs from different topics get orthogonal
# embeddings (cosine distance 1). Test fixtures below use one short
# "paragraph" per sentence (each on its own line, separated by blank lines)
# so the binary search over percentile thresholds has multiple same-topic
# units to search over, fully predictable and hash-free, with no real
# embedding model or network access required.


def _topic_embedding_function(topics_by_keyword):
    """
    Returns an embedding_function that assigns a one-hot vector per topic,
    based on which keyword (from `topics_by_keyword`, a dict of
    keyword -> topic_index) appears in each input string.
    """
    num_topics = len(set(topics_by_keyword.values()))

    def embed(texts):
        vectors = []
        for text in texts:
            topic_index = 0
            for keyword, idx in topics_by_keyword.items():
                if keyword in text:
                    topic_index = idx
                    break
            vector = [0.0] * num_topics
            vector[topic_index] = 1.0
            vectors.append(vector)
        return vectors

    return embed


# Each topic is three short paragraphs (blank-line-separated), so within a
# topic there are still multiple units for the binary search to work with.
TOPIC_A = (
    "Cats are small domesticated carnivorous mammals.\n\n"
    "Cats have retractable claws.\n\n"
    "Cats are popular pets worldwide."
)
TOPIC_B = (
    "Quantum computers use qubits instead of classical bits.\n\n"
    "Quantum computers exploit superposition.\n\n"
    "Quantum computers may break current encryption."
)


def test_missing_embedding_function_raises_value_error():
    # embedding_function is required -- there is no default embedding
    # model, so omitting it must raise a clear, actionable error rather
    # than silently downloading something or failing deep inside chunk().
    with pytest.raises(ValueError):
        SemanticChunker()


def test_rejects_invalid_target_chunk_size():
    embed = _topic_embedding_function({})
    with pytest.raises(ValueError):
        SemanticChunker(embedding_function=embed, target_chunk_size=0)


def test_rejects_invalid_buffer_size():
    embed = _topic_embedding_function({})
    with pytest.raises(ValueError):
        SemanticChunker(embedding_function=embed, buffer_size=-1)


def test_rejects_invalid_percentile_bounds():
    embed = _topic_embedding_function({})
    with pytest.raises(ValueError):
        SemanticChunker(embedding_function=embed, min_percentile=90, max_percentile=10)


def test_rejects_invalid_tolerance():
    embed = _topic_embedding_function({})
    with pytest.raises(ValueError):
        SemanticChunker(embedding_function=embed, tolerance=0)
    with pytest.raises(ValueError):
        SemanticChunker(embedding_function=embed, tolerance=1)


def test_rejects_invalid_unit():
    embed = _topic_embedding_function({})
    with pytest.raises(ValueError):
        SemanticChunker(embedding_function=embed, unit="word")


def test_default_unit_is_paragraph():
    embed = _topic_embedding_function({})
    chunker = SemanticChunker(embedding_function=embed)
    assert chunker.unit == "paragraph"


def test_empty_text_returns_no_chunks():
    embed = _topic_embedding_function({})
    chunker = SemanticChunker(embedding_function=embed, target_chunk_size=50)

    assert chunker.chunk("", filename="test.txt") == []
    assert chunker.chunk("   \n  ", filename="test.txt") == []


def test_text_with_no_paragraph_breaks_returns_one_chunk():
    embed = _topic_embedding_function({"Cats": 0})
    chunker = SemanticChunker(embedding_function=embed, target_chunk_size=50)

    chunks = chunker.chunk("Cats are great pets.", filename="test.txt")

    assert len(chunks) == 1
    assert chunks[0].text == "Cats are great pets."


def test_splits_at_genuine_topic_shift():
    embed = _topic_embedding_function({"Cats": 0, "Quantum": 1})
    text = f"{TOPIC_A}\n\n{TOPIC_B}"
    chunker = SemanticChunker(
        embedding_function=embed, target_chunk_size=len(TOPIC_A), buffer_size=0
    )

    chunks = chunker.chunk(text, filename="test.txt")

    # Every same-topic paragraph pair has distance 0; the single cross-topic
    # pair has distance 1 -- a real topic shift the binary search should
    # always keep as a split, regardless of the exact percentile it lands on.
    assert len(chunks) == 2
    assert "Cats" in chunks[0].text and "Quantum" not in chunks[0].text
    assert "Quantum" in chunks[1].text and "Cats" not in chunks[1].text


def test_binary_search_converges_toward_target_chunk_size():
    embed = _topic_embedding_function({"Cats": 0, "Quantum": 1})
    text = f"{TOPIC_A}\n\n{TOPIC_B}"

    # Target roughly the size of a single topic's text -- the search should
    # settle on splitting at the topic boundary rather than merging both
    # topics into one oversized chunk or fragmenting within a topic (there's
    # no signal to fragment on, since same-topic distances are all 0).
    chunker = SemanticChunker(
        embedding_function=embed,
        target_chunk_size=len(TOPIC_A),
        buffer_size=0,
        tolerance=0.2,
    )
    chunks = chunker.chunk(text, filename="test.txt")

    avg_size = sum(len(c.text) for c in chunks) / len(chunks)
    assert abs(avg_size - len(TOPIC_A)) <= 0.5 * len(TOPIC_A)


def test_chunk_metadata_indices_and_total():
    embed = _topic_embedding_function({"Cats": 0, "Quantum": 1})
    text = f"{TOPIC_A}\n\n{TOPIC_B}"
    chunker = SemanticChunker(
        embedding_function=embed, target_chunk_size=len(TOPIC_A), buffer_size=0
    )

    chunks = chunker.chunk(text, filename="test.txt")

    assert [c.metadata["chunk_index"] for c in chunks] == list(range(len(chunks)))
    assert all(c.metadata["total_chunks"] == len(chunks) for c in chunks)
    assert all(c.metadata["filename"] == "test.txt" for c in chunks)


def test_page_no_none_when_no_markers():
    embed = _topic_embedding_function({"Cats": 0})
    chunker = SemanticChunker(embedding_function=embed, target_chunk_size=50)

    chunks = chunker.chunk(TOPIC_A, filename="test.txt")

    assert all(c.metadata["page_no"] is None for c in chunks)


def test_page_no_attributed_from_markers():
    embed = _topic_embedding_function({"Cats": 0, "Quantum": 1})
    text = (
        f"<!-- Page number: 1 -->\n{TOPIC_A}\n\n" f"<!-- Page number: 2 -->\n{TOPIC_B}"
    )
    chunker = SemanticChunker(
        embedding_function=embed, target_chunk_size=len(TOPIC_A), buffer_size=0
    )

    chunks = chunker.chunk(text, filename="test.txt")

    assert all("Page number" not in c.text for c in chunks)
    assert [c.metadata["page_no"] for c in chunks] == [1, 2]


def test_oversized_paragraph_falls_back_to_sentence_splitting():
    # A single paragraph (no blank lines) that's much larger than
    # target_chunk_size must still get split -- otherwise one huge
    # paragraph would defeat target_chunk_size entirely by becoming one
    # unsplittable, oversized chunk.
    embed = _topic_embedding_function({"Cats": 0, "Quantum": 1})
    huge_paragraph = TOPIC_A.replace("\n\n", " ") + " " + TOPIC_B.replace("\n\n", " ")
    chunker = SemanticChunker(
        embedding_function=embed, target_chunk_size=20, buffer_size=0
    )

    chunks = chunker.chunk(huge_paragraph, filename="test.txt")

    assert len(chunks) > 1


# unit="sentence" fixtures: single-space-joined, no blank lines -- Kamradt's
# original granularity, and also a regression check for the chunker's
# pre-paragraph-default behavior.
SENTENCE_TOPIC_A = TOPIC_A.replace("\n\n", " ")
SENTENCE_TOPIC_B = TOPIC_B.replace("\n\n", " ")


def test_sentence_unit_splits_on_sentences_not_paragraphs():
    embed = _topic_embedding_function({"Cats": 0, "Quantum": 1})
    text = f"{SENTENCE_TOPIC_A} {SENTENCE_TOPIC_B}"
    chunker = SemanticChunker(
        embedding_function=embed,
        target_chunk_size=len(SENTENCE_TOPIC_A),
        buffer_size=0,
        unit="sentence",
    )

    chunks = chunker.chunk(text, filename="test.txt")

    # With unit="paragraph" (default), this single-blob text (no blank
    # lines) would collapse into one paragraph and refuse to split. With
    # unit="sentence", it must still find the topic boundary.
    assert len(chunks) == 2
    assert "Cats" in chunks[0].text and "Quantum" not in chunks[0].text
    assert "Quantum" in chunks[1].text and "Cats" not in chunks[1].text
    # Sentence-unit chunks are space-joined, not blank-line-joined.
    assert "\n\n" not in chunks[0].text
    assert "\n\n" not in chunks[1].text


def test_paragraph_unit_does_not_split_single_blob_text():
    # The same text used above, but confirming the default ("paragraph")
    # behavior really is different: with no blank lines, it's all one
    # paragraph, so it can only ever produce a single chunk regardless of
    # target_chunk_size.
    embed = _topic_embedding_function({"Cats": 0, "Quantum": 1})
    text = f"{SENTENCE_TOPIC_A} {SENTENCE_TOPIC_B}"
    chunker = SemanticChunker(
        embedding_function=embed,
        target_chunk_size=len(SENTENCE_TOPIC_A),
        buffer_size=0,
    )

    chunks = chunker.chunk(text, filename="test.txt")

    assert len(chunks) == 1
