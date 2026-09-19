# MarkItDown web app

Drag-and-drop file conversion in the browser, backed by the local (editable)
`markitdown` package from `packages/markitdown` -- not a PyPI install.

- `backend/` -- FastAPI, converts uploads via `MarkItDown().convert_stream()`
  and optionally chunks the result (`character`, `recursive`, or `token`
  strategy). Projects and their converted files are stored in SQLite at
  `backend/data/app.db` (see `backend/db.py`); on first run it imports any
  existing `backend/data/projects.json` from the old file-backed store.
- `frontend/` -- React + Vite, drag-and-drop upload, markdown/chunk viewer,
  copy/download.

## Auth

Single local account, JWT-based (see `backend/auth.py`). There's no open
registration: the first username/password submitted via `/api/auth/register`
becomes the one account for this instance, and every later registration
attempt is rejected. Log in after that via `/api/auth/login`. The JWT is set
as an httpOnly cookie (`access_token`, 30-day expiry) -- not readable by
frontend JS, sent automatically by the browser. All `/api/*` routes except
`/api/auth/*` and `/api/health` require it.

The signing secret is generated on first run and persisted to
`backend/data/.jwt_secret` (gitignored); set `JWT_SECRET` in the environment
to override it. Passwords are hashed with `bcrypt`.

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

Open http://localhost:5173 -- you'll be prompted to create the account on
first visit. The frontend talks to the backend at `http://localhost:8000`
(hardcoded as `API_BASE` in `src/lib/api.ts` -- adjust if you run the backend
elsewhere; the backend's CORS `allow_origins` in `main.py` must match).

## Not included (yet)

- **`semantic` chunking strategy** -- deliberately left out of the web UI.
  It requires an `embedding_function`, and the CLI's approach (pointing at
  a local Python file to import and execute) isn't something that
  translates safely to a web upload form without a lot more thought about
  what's safe to expose. Character/recursive/token chunking cover the web
  UI for now.
- **Large file handling / progress indication** -- uploads are synchronous;
  a very large PDF will just make the browser wait.
- Rate limiting, request size limits, multi-user accounts -- this is a
  single-user local dev tool, not hardened for public deployment.
