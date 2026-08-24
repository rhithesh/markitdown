# MarkItDown web app

Drag-and-drop file conversion in the browser, backed by the local (editable)
`markitdown` package from `packages/markitdown` -- not a PyPI install.

- `backend/` -- FastAPI, converts uploads via `MarkItDown().convert_stream()`
  and optionally chunks the result (`character`, `recursive`, or `token`
  strategy).
- `frontend/` -- React + Vite, drag-and-drop upload, markdown/chunk viewer,
  copy/download.

## Run it

**Backend** (from `webapp/backend/`):
```bash
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8000
```

**Frontend** (from `webapp/frontend/`):
```bash
npm install
npm run dev
```

Open http://localhost:5173. The frontend talks to the backend at
`http://localhost:8000` (hardcoded in `src/App.tsx`'s `API_BASE` -- adjust
if you run the backend elsewhere).

## Not included (yet)

- **`semantic` chunking strategy** -- deliberately left out of the web UI.
  It requires an `embedding_function`, and the CLI's approach (pointing at
  a local Python file to import and execute) isn't something that
  translates safely to a web upload form without a lot more thought about
  what's safe to expose. Character/recursive/token chunking cover the web
  UI for now.
- **Large file handling / progress indication** -- uploads are synchronous;
  a very large PDF will just make the browser wait.
- Auth, rate limiting, request size limits -- this is a local dev tool, not
  hardened for public deployment.
