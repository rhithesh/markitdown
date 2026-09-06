"""
SQLite persistence for the MarkItDown web app.

Plain stdlib ``sqlite3`` -- no ORM, no extra dependencies. Everything lives in
a single file at ``backend/data/app.db``. Connections are opened per call:
sqlite3 connection objects aren't safe to share across threads and FastAPI
runs sync endpoints in a threadpool, so a short-lived connection per request
is the simplest correct option (and cheap for a local single-file DB).

On first run this imports any existing ``data/projects.json`` (the previous
file-backed store) and then leaves a marker so it won't import again.
"""

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, List, Optional

_DATA_DIR = Path(__file__).parent / "data"
_DB_FILE = _DATA_DIR / "app.db"
_LEGACY_JSON = _DATA_DIR / "projects.json"
_MIGRATED_MARKER = _DATA_DIR / ".migrated-to-sqlite"


class DuplicateName(Exception):
    """Raised when a project name collides with an existing one."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(n: int = 12) -> str:
    return uuid.uuid4().hex[:n]


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """A committed-on-success, rolled-back-on-error connection."""
    conn = sqlite3.connect(_DB_FILE, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # per-connection, does not persist
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    name_lower     TEXT NOT NULL UNIQUE,
    description    TEXT,
    chunk_strategy TEXT,
    chunk_size     INTEGER,
    chunk_overlap  INTEGER NOT NULL DEFAULT 0,
    chunk_model    TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_files (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    title      TEXT,
    markdown   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    chars      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files (project_id);
"""

# Every project read goes through this so ``file_count`` is always accurate.
_PROJECT_SELECT = """
SELECT p.id, p.name, p.description, p.chunk_strategy, p.chunk_size,
       p.chunk_overlap, p.chunk_model, p.created_at, p.updated_at,
       (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count
FROM projects p
"""

_FILE_SELECT = (
    "SELECT id, filename, title, markdown, created_at, chars FROM project_files"
)


def init_db() -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_FILE)
    try:
        conn.execute("PRAGMA journal_mode = WAL")  # persists in the db file
        conn.executescript(_SCHEMA)
        conn.commit()
    finally:
        conn.close()
    _maybe_import_legacy()


def _maybe_import_legacy() -> None:
    if _MIGRATED_MARKER.exists() or not _LEGACY_JSON.exists():
        return
    with connect() as conn:
        if conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]:
            _MIGRATED_MARKER.touch()
            return
        try:
            raw = json.loads(_LEGACY_JSON.read_text(encoding="utf-8"))
        except Exception:
            return
        rows = raw if isinstance(raw, list) else list(raw.values())
        imported = 0
        for p in rows:
            if not isinstance(p, dict) or not p.get("id") or not p.get("name"):
                continue
            try:
                conn.execute(
                    "INSERT INTO projects (id, name, name_lower, description, "
                    "chunk_strategy, chunk_size, chunk_overlap, chunk_model, "
                    "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (
                        p["id"],
                        p["name"],
                        str(p["name"]).strip().lower(),
                        p.get("description"),
                        p.get("chunk_strategy"),
                        p.get("chunk_size"),
                        int(p.get("chunk_overlap") or 0),
                        p.get("chunk_model"),
                        p.get("created_at") or now_iso(),
                        p.get("updated_at") or p.get("created_at") or now_iso(),
                    ),
                )
            except sqlite3.IntegrityError:
                continue
            imported += 1
            for f in p.get("files") or []:
                if not isinstance(f, dict) or not f.get("id"):
                    continue
                md = f.get("markdown") or ""
                conn.execute(
                    "INSERT OR IGNORE INTO project_files (id, project_id, filename, "
                    "title, markdown, created_at, chars) VALUES (?,?,?,?,?,?,?)",
                    (
                        f["id"],
                        p["id"],
                        f.get("filename") or "untitled",
                        f.get("title"),
                        md,
                        f.get("created_at") or now_iso(),
                        int(f.get("chars") or len(md)),
                    ),
                )
        print(f"[db] imported {imported} project(s) from {_LEGACY_JSON.name}")
    _MIGRATED_MARKER.touch()


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


def list_projects() -> List[dict]:
    with connect() as conn:
        rows = conn.execute(
            _PROJECT_SELECT + " ORDER BY p.created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_project(project_id: str) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute(
            _PROJECT_SELECT + " WHERE p.id = ?", (project_id,)
        ).fetchone()
    return dict(row) if row else None


def name_exists(name: str, exclude_id: Optional[str] = None) -> bool:
    key = name.strip().lower()
    with connect() as conn:
        if exclude_id:
            row = conn.execute(
                "SELECT 1 FROM projects WHERE name_lower = ? AND id != ?",
                (key, exclude_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT 1 FROM projects WHERE name_lower = ?", (key,)
            ).fetchone()
    return row is not None


def create_project(fields: dict) -> dict:
    project_id = new_id()
    now = now_iso()
    try:
        with connect() as conn:
            conn.execute(
                "INSERT INTO projects (id, name, name_lower, description, "
                "chunk_strategy, chunk_size, chunk_overlap, chunk_model, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    project_id,
                    fields["name"],
                    fields["name"].strip().lower(),
                    fields.get("description"),
                    fields.get("chunk_strategy"),
                    fields.get("chunk_size"),
                    int(fields.get("chunk_overlap") or 0),
                    fields.get("chunk_model"),
                    now,
                    now,
                ),
            )
    except sqlite3.IntegrityError as e:
        raise DuplicateName(str(e))
    result = get_project(project_id)
    assert result is not None
    return result


_UPDATABLE_COLUMNS = (
    "name",
    "description",
    "chunk_strategy",
    "chunk_size",
    "chunk_overlap",
    "chunk_model",
)


def update_project(project_id: str, fields: dict) -> Optional[dict]:
    assignments = []
    params: List[object] = []
    for col in _UPDATABLE_COLUMNS:
        if col in fields:
            assignments.append(f"{col} = ?")
            params.append(fields[col])
    if "name" in fields:
        assignments.append("name_lower = ?")
        params.append(str(fields["name"]).strip().lower())
    assignments.append("updated_at = ?")
    params.append(now_iso())
    params.append(project_id)
    try:
        with connect() as conn:
            cur = conn.execute(
                f"UPDATE projects SET {', '.join(assignments)} WHERE id = ?",
                params,
            )
            if cur.rowcount == 0:
                return None
    except sqlite3.IntegrityError as e:
        raise DuplicateName(str(e))
    return get_project(project_id)


def touch_project(project_id: str) -> Optional[dict]:
    with connect() as conn:
        cur = conn.execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            (now_iso(), project_id),
        )
        if cur.rowcount == 0:
            return None
    return get_project(project_id)


def delete_project(project_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Project files
# ---------------------------------------------------------------------------


def list_files(project_id: str) -> List[dict]:
    with connect() as conn:
        rows = conn.execute(
            _FILE_SELECT
            + " WHERE project_id = ? ORDER BY created_at DESC, rowid DESC",
            (project_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def add_files(project_id: str, records: List[dict]) -> List[dict]:
    """Insert converted files, bump the project's ``updated_at``, and return
    the new rows in the order given."""
    now = now_iso()
    ids: List[str] = []
    with connect() as conn:
        for rec in records:
            file_id = new_id(10)
            ids.append(file_id)
            conn.execute(
                "INSERT INTO project_files (id, project_id, filename, title, "
                "markdown, created_at, chars) VALUES (?,?,?,?,?,?,?)",
                (
                    file_id,
                    project_id,
                    rec["filename"],
                    rec.get("title"),
                    rec["markdown"],
                    now,
                    int(rec.get("chars") or len(rec["markdown"])),
                ),
            )
        conn.execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id)
        )
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"{_FILE_SELECT} WHERE id IN ({placeholders})", ids
        ).fetchall()
    by_id = {r["id"]: dict(r) for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def delete_file(project_id: str, file_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM project_files WHERE id = ? AND project_id = ?",
            (file_id, project_id),
        )
        if cur.rowcount == 0:
            return False
        conn.execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            (now_iso(), project_id),
        )
        return True
