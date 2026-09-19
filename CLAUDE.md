# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This is a monorepo, standalone since detaching from `microsoft/markitdown` on 2026-08-22 (full history retained, but changes here are independent and not upstreamed). It contains:

- `packages/markitdown` — the core library: converts files (PDF, Office formats, images, audio, HTML, EPUB, etc.) to Markdown, plus a chunking module for RAG/embedding pipelines.
- `packages/markitdown-mcp` — an MCP server wrapping the library.
- `packages/markitdown-ocr` — an optional plugin adding LLM-vision OCR to PDF/DOCX/PPTX/XLSX converters.
- `packages/markitdown-sample-plugin` — reference implementation for the 3rd-party plugin interface (adds RTF support).
- `webapp/` — a local dev web UI (FastAPI backend + React/Vite frontend) for drag-and-drop conversion, backed by the *editable* `packages/markitdown` source, not a PyPI install.
- `momodocs/` — a separate Next.js project with its own `AGENTS.md`/`CLAUDE.md`; unrelated to the markitdown library itself.

## Common commands

### Core library (`packages/markitdown`)

```bash
cd packages/markitdown
pip install hatch
hatch test                 # run the full test suite (matrixed in CI across Python 3.10-3.12)
hatch test tests/test_module_vectors.py   # run a single test file
hatch test -k test_name    # run a single test by name (pytest -k passthrough)
hatch run types:check      # mypy
pre-commit run --all-files # black formatting (repo-wide pre-commit hook)
```

CI (`.github/workflows/tests.yml`) just runs `hatch test` from `packages/markitdown` across Python 3.10/3.11/3.12 — there's no separate lint job for the Python packages beyond the `black` pre-commit hook.

### Web app (`webapp/`)

```bash
webapp/start.sh   # kills anything on :8000/:5173, starts both, tails logs, Ctrl-C stops both
```

Or manually:
```bash
# backend (webapp/backend/) — installs the local editable markitdown package
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8000

# frontend (webapp/frontend/)
npm install
npm run dev       # vite dev server on :5173
npm run build     # tsc -b && vite build
npm run lint       # oxlint
```

The frontend's `API_BASE` (in `src/lib/api.ts`) is hardcoded to `http://localhost:8000` — update it (and the backend's CORS `allow_origins` in `main.py`) if the backend runs elsewhere. Backend/frontend logs when using `start.sh` go to `webapp/.logs/`.

## Core library architecture (`packages/markitdown/src/markitdown`)

**Conversion pipeline**: `MarkItDown` (`_markitdown.py`) is the entry point. It holds an ordered list of `ConverterRegistration` (converter + priority) and, for a given input, calls each converter's `accepts(file_stream, stream_info)` in priority order (lower priority value = tried first), then `convert()` on the first that accepts. Public entry points — `convert()`, `convert_local()`, `convert_stream()`, `convert_uri()`, `convert_response()` — all normalize their input down to a `(BinaryIO, StreamInfo)` pair before dispatch. `StreamInfo` (`_stream_info.py`) carries mimetype/extension/charset/filename/url used for format sniffing (via `magika`).

**Priority model**: two constants govern ordering — `PRIORITY_SPECIFIC_FILE_FORMAT` (0.0, default for most converters — e.g. `.docx`, `.pdf`, Wikipedia/YouTube page converters) and `PRIORITY_GENERIC_FILE_FORMAT` (10.0, catch-alls like `PlainTextConverter`, `HtmlConverter`, `ZipConverter`). Later registrations are tried before earlier ones at the same priority, so `enable_builtins()` in `_markitdown.py` registers generic converters first and specific ones after.

**Adding a converter**: implement `DocumentConverter` (`_base_converter.py`) — `accepts()` (must not leave `file_stream` position altered on return) and `convert()` (returns `DocumentConverterResult`, which wraps `markdown` + optional `title`). Register it in `converters/__init__.py`'s exports and in `MarkItDown.enable_builtins()`.

**Plugin system**: 3rd-party plugins register via the `markitdown.plugin` entry-point group (see `packages/markitdown-sample-plugin/pyproject.toml`) and are loaded lazily (`_load_plugins()`) only when `enable_plugins=True`. A plugin package exposes a `register_converters(markitdown, **kwargs)` function that calls `markitdown.register_converter(...)`. Plugins are opt-in — a failing plugin load only warns, never raises.

**Chunking module** (`chunking/`): all chunkers implement `BaseChunker.chunk(text, *, filename=None) -> List[Chunk]`. Four strategies: `CharacterChunker` (strict char count), `RecursiveCharacterChunker` (prefers paragraph/line/sentence/word boundaries, falls back to raw chars), `TokenChunker` (tiktoken for OpenAI models, HuggingFace `transformers.AutoTokenizer` otherwise — network access needed on first use for non-OpenAI models), and `SemanticChunker` (Chroma-style: embeds paragraph/sentence units via a user-supplied `embedding_function`, binary-searches a cosine-distance threshold to converge chunk sizes on `target_chunk_size`). Only `SemanticChunker` requires an external dependency the user must supply (no default embedding model). CLI wiring lives in `__main__.py`; `--chunk-strategy semantic` needs `--embedding-function path/to/file.py:function_name`, which is imported and executed directly like a plugin (only point it at trusted files).

**Optional dependencies**: converters requiring extra libraries (PDF, DOCX, XLSX, audio transcription, Azure Document Intelligence / Content Understanding, YouTube transcripts, tiktoken/transformers for chunking) are gated behind `pyproject.toml` extras (`[pdf]`, `[docx]`, `[all]`, `[chunking]`, etc.) — see the extras table in `README.md`. A converter should raise `MissingDependencyException` (not ImportError) when its optional deps aren't installed.

**Security note baked into the design**: `convert()` is intentionally permissive (local paths, URLs, byte streams). Code that only needs to handle trusted local files should call `convert_local()`; code fetching remote content should prefer `convert_response()` with its own `requests.get()` call for tighter control. Don't widen `convert()`'s surface without considering this.

## Web app architecture (`webapp/`)

- `backend/main.py` — FastAPI app using a single shared `MarkItDown()` instance (construction only registers converters, so it's safe to reuse across requests). Three API surfaces: auth (`/api/auth/...`), one-off conversion (`/api/convert`, `/api/model-search`, `/api/tokenizer-check`), and a Projects CRUD API (`/api/projects/...`) for multi-file collections with a saved chunking config. Every route except `/api/health` and `/api/auth/*` takes a `Depends(auth.get_current_user)` dependency.
- `backend/db.py` — plain stdlib `sqlite3` (no ORM) persisting to `backend/data/app.db`; opens a short-lived connection per call rather than sharing one across FastAPI's threadpool. On first run it auto-imports a legacy `backend/data/projects.json` file store and marks itself migrated. Also holds the single-row `users` table.
- `backend/auth.py` — single-user JWT auth. The first `/api/auth/register` call claims the one account (bcrypt-hashed password); every later registration attempt 409s. Login issues a JWT stored as an httpOnly cookie (not readable by frontend JS), signed with a secret generated on first run and persisted to `backend/data/.jwt_secret` (override via `JWT_SECRET` env var). See `webapp/README.md` for the full auth flow.
- Web UI deliberately excludes `semantic` chunking (would require executing an arbitrary user-supplied Python file server-side) and isn't hardened for multi-tenant/public deployment (no rate limiting, single account only; see `webapp/README.md`).
- `frontend/` — React 19 + Vite + Tailwind v4 + shadcn/ui (Radix-based) components in `src/components/ui/`. `src/lib/api.ts` wraps `fetch` to always send the auth cookie (`credentials: "include"`) and broadcast 401s; `src/lib/auth.tsx` is the `AuthProvider`/`useAuth()` context gating `App.tsx` between the `Login` page and the real routes. Pages: `Playground.tsx` (one-off convert/chunk), `Projects.tsx` / `ProjectDetail.tsx` (multi-file project workflow). Routing via `react-router-dom`.
- **Gotcha**: the root `.gitignore`'s Python-oriented `lib/` rule also matches `webapp/frontend/src/lib/` — there are explicit negation entries right after it to keep that directory tracked. Don't remove them.
