# SemanticChunker: sentence vs. paragraph splitting

Validated on a real 256-page book, *Atomic Habits* by James Clear, against
its 20 known chapter boundaries, using the `sentence-transformers`
`all-MiniLM-L6-v2` embedding model.

| | Sentence-based (before) | Paragraph-based (after) |
|---|---|---|
| Clean chapter-boundary cuts | 1/20 | 17/20 |
| Avg. relative position of boundary in chunk | 47% (~random) | 10% (near-clean) |

**Why**: a single sentence taken in isolation is a weak, noisy signal --
`"Focus on your system instead."` could be about almost anything out of
context. A whole paragraph almost never straddles two different topics, so
comparing paragraph-to-paragraph gives the embedding model a much cleaner
signal to detect a real topic shift on.

One tradeoff: chunk size control got slightly looser, since paragraphs vary
more in length than sentences do.
