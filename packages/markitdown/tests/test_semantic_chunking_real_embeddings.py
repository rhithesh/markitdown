#!/usr/bin/env python3 -m pytest
"""
Real-embedding validation for SemanticChunker's unit="paragraph" vs
unit="sentence" modes.

test_semantic_chunking.py uses a synthetic one-hot embedding_function for
fully deterministic, offline testing of the chunking *logic* (the binary
search, edge cases, metadata). That's necessary but doesn't prove anything
about real chunk *quality*, since synthetic embeddings guarantee clean
topic separation by construction.

This file uses a real sentence-transformers model instead, to guard the
actual finding that justified making unit="paragraph" the default: manual
validation against a real 256-page book with known chapter boundaries found
unit="paragraph" landed a clean or near-clean cut on 17/20 real chapter
boundaries, versus 1/20 for unit="sentence" (sentence-level distance was
close to random at detecting real, long-range topic shifts). This test
keeps that finding from silently regressing, using a much smaller
synthetic-topic passage so it doesn't depend on an external document.

Skipped entirely if sentence-transformers isn't installed, since it's a
heavy optional dependency (pulls in torch) not needed for the rest of the
test suite.
"""
import pytest

sentence_transformers = pytest.importorskip("sentence_transformers")

from markitdown import SemanticChunker

# Two clearly distinct real-world topics, each as three REAL paragraphs (2-3
# sentences per paragraph, not one sentence each -- a paragraph containing
# only one sentence gives paragraph-splitting and sentence-splitting nearly
# identical unit lists, which defeats the point of comparing them. Multiple
# sentences per paragraph is what lets paragraph-mode meaningfully reduce
# the unit count and avoid fragmenting mid-paragraph, which is the actual
# mechanism behind its real-world advantage.
CATS_PARAGRAPHS = "\n\n".join(
    [
        "Cats are small domesticated carnivorous mammals valued by humans for companionship. "
        "They have flexible bodies and sharp retractable claws that help them hunt small prey "
        "like mice and birds. Domestic cats are one of the most popular pets in the world, "
        "found in millions of households.",
        "Cats spend a large portion of their day sleeping, often more than twelve hours. "
        "Unlike dogs, cats were largely self-domesticated as they began living near early "
        "human grain stores. Their whiskers are highly sensitive and help them navigate and "
        "judge spaces in the dark.",
        "Many cat breeds, such as the Siamese and Persian, have distinct physical traits and "
        "temperaments. Purring in cats is associated with contentment, though cats sometimes "
        "purr when injured or stressed too.",
    ]
)

QUANTUM_PARAGRAPHS = "\n\n".join(
    [
        "Quantum computers use qubits instead of classical binary bits to represent "
        "information. Superposition allows a qubit to represent multiple states "
        "simultaneously, unlike a classical bit. Some experts believe sufficiently powerful "
        "quantum computers could break widely used encryption schemes.",
        "Quantum entanglement links the state of two qubits so that measuring one instantly "
        "affects the other. Building stable qubits requires extremely low temperatures, "
        "often colder than outer space.",
        "Companies like IBM and Google have built quantum processors with over a hundred "
        "qubits. Quantum error correction is a major research challenge because qubits are "
        "highly sensitive to noise. Potential quantum computing applications include drug "
        "discovery, materials science, and optimization problems.",
    ]
)


@pytest.fixture(scope="module")
def embed():
    model = sentence_transformers.SentenceTransformer("all-MiniLM-L6-v2")
    return lambda texts: model.encode(texts, show_progress_bar=False)


def _relative_boundary_position(chunks, marker):
    """
    Where does `marker` (the real topic-boundary text) sit within the chunk
    that contains it? 0.0 = right at the start of the chunk (a clean cut
    landed exactly at the boundary); close to 1.0 = buried near the end
    (the chunk mostly absorbed the *other* topic before reaching it).
    This is the same relative-position metric used to validate
    unit="paragraph" against a real 256-page book (17/20 boundaries landed
    under ~10% on average, vs ~47-80% for unit="sentence" depending on
    target size) -- comparing relative position, not demanding a
    zero-error "never mixes topics" cut, since even the validated result
    wasn't 20/20.
    """
    for c in chunks:
        if marker in c.text:
            pos = c.text.index(marker)
            return pos / len(c.text) if c.text else 0.0
    return None


# Text right at the start of the real topic boundary -- used to measure how
# cleanly each unit mode cuts at the actual cats -> quantum transition.
BOUNDARY_MARKER = "Quantum computers use qubits instead of classical binary bits"


def test_paragraph_unit_cuts_closer_to_the_real_boundary_than_sentence_unit(embed):
    text = f"{CATS_PARAGRAPHS}\n\n{QUANTUM_PARAGRAPHS}"
    target_chunk_size = 300  # mid-range: small enough to force multiple chunks

    paragraph_chunks = SemanticChunker(
        embedding_function=embed, target_chunk_size=target_chunk_size, unit="paragraph"
    ).chunk(text, filename="test.txt")
    sentence_chunks = SemanticChunker(
        embedding_function=embed, target_chunk_size=target_chunk_size, unit="sentence"
    ).chunk(text, filename="test.txt")

    paragraph_position = _relative_boundary_position(paragraph_chunks, BOUNDARY_MARKER)
    sentence_position = _relative_boundary_position(sentence_chunks, BOUNDARY_MARKER)

    assert (
        paragraph_position is not None
    ), "boundary marker not found in any paragraph-unit chunk"
    assert (
        sentence_position is not None
    ), "boundary marker not found in any sentence-unit chunk"
    assert paragraph_position < sentence_position, (
        f"paragraph-unit boundary position ({paragraph_position:.2f}) should land "
        f"closer to the start of its chunk than sentence-unit ({sentence_position:.2f}) "
        "on this real-embedding topic shift -- paragraph-unit's advantage may have regressed"
    )


def test_sentence_unit_runs_and_produces_valid_chunks(embed):
    # Sentence-level granularity is intentionally NOT asserted to cleanly
    # separate topics here -- validated to perform close to random at real
    # long-range boundary detection. This test only guards against outright
    # breakage (crashes, empty/malformed output), not chunk quality.
    text = f"{CATS_PARAGRAPHS}\n\n{QUANTUM_PARAGRAPHS}"
    chunker = SemanticChunker(
        embedding_function=embed, target_chunk_size=250, unit="sentence"
    )

    chunks = chunker.chunk(text, filename="test.txt")

    assert len(chunks) >= 1
    assert all(c.text.strip() for c in chunks)
    assert all(c.metadata["filename"] == "test.txt" for c in chunks)
