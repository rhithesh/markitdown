# Roadmap

## Open questions -- resolve before adding more surface area

Honest assessment as of 2026-08-22: the core conversion engine (inherited) is solid and production-grade. The chunking work added this session is well-designed and well-tested *at the unit level*, but has real gaps that are more important than any new feature below:

- **Project identity is unresolved.** In one session: renamed the package, published to PyPI under that name, reverted the rename, added a "detached from upstream" note, then reverted branding back to match upstream "for now." Every README/pyproject/badge decision keeps getting redone because there's no settled answer to "is this a personal fork that tracks `microsoft/markitdown`, or an independent project with its own identity?" Answer this before touching branding again.
- **The `-rag` in `markitdown-chuncking-rag` is currently aspirational, not real.** There's no retrieval, no vector store integration, no embedding storage -- just conversion plus chunking. Either build actual RAG functionality (see "RAG-adjacent value-adds" below) or don't imply it exists yet.
- **`SemanticChunker` has never been validated against a real embedding model on a real document.** All tests use synthetic one-hot vectors that guarantee clean topic separation by construction. The one real-model run we did (before the sentence-transformers default was removed) split a 4-sentence toy example at the wrong point. Needs a real end-to-end run on an actual multi-page document with a real embedding model before it's trusted for production use.
- **`momodocs/` is dead weight as-is.** An empty Next.js scaffold committed with a "groundwork for rebrand" message, for a rebrand that's explicitly deferred. Either build it out or delete it -- a half-started docs site with no content isn't helping anyone.

## Shipped

- **Chunking module**: `CharacterChunker`, `RecursiveCharacterChunker`, `TokenChunker`, `SemanticChunker` — all behind one `BaseChunker` interface, all wired into both the CLI (`--chunk-strategy`) and the Python API.
- **`SemanticChunker`**: Chroma's target-size-aware modification of Greg Kamradt's semantic chunking. Requires an explicit `embedding_function` — no default embedding model, nothing downloaded automatically. CLI support via `--chunk-strategy semantic --embedding-function path/to/file.py:function_name` (dynamically imports a user-supplied file, like a plugin).
- **Chunk metadata**: `filename`, `chunk_index`, `total_chunks`, `page_no` (PDF/PPTX only -- see below), plus `token_count` for `TokenChunker`.
- Detached from the upstream `microsoft/markitdown` fork (2026-08-22); operating as a standalone project for now, full rebrand deferred.

## Planned / under consideration

- **`section_title` chunk metadata**: track which heading/section a chunk falls under, the same way `page_no` already tracks page/slide position via `page_at_offset()`. Needs two pieces:
  1. Per-format heading detection -- PDF (font-size relative to body text, explored but not yet merged), DOCX (paragraph style names), PPTX (slide titles), HTML (`<h1>`-`<h6>`), Markdown output (`#`/`##` syntax already present in most converter output).
  2. A heading-offset tracking mechanism analogous to the existing page-marker system, so chunkers can look up "closest preceding heading" the same way they look up "closest preceding page number."
- **`page_no` coverage beyond PDF/PPTX**: currently only these two converters emit page/slide markers; every other format (DOCX, XLSX, HTML, CSV, EPUB, images, audio, ZIP) always returns `page_no: null`. Worth deciding which formats have a meaningful enough notion of "page" to extend this to (e.g. DOCX doesn't paginate the same way, but section/heading tracking could partially substitute).
- **momodocs**: currently an empty Next.js scaffold (`momodocs/`) intended as future documentation groundwork -- no real content yet.
- **Full rebrand**: new project name/identity, own PyPI package, own badges/CI -- explicitly deferred; current README/pyproject still mirror upstream `markitdown` branding on purpose.
- **RAG-adjacent value-adds**: possible built-in vector-store adapters, an embeddings cache, or a one-call `convert_and_chunk()` helper that skips the two-step `convert()` -> `chunker.chunk()` dance.

## Explored, not merged

- PDF font-size-based heading detection (`## `/`### ` markdown headings inferred from relative font size on `pdfplumber` pages) -- implemented and tested in an earlier session but reverted from the working tree before commit. Would be a direct building block for `section_title` metadata on PDFs specifically.
