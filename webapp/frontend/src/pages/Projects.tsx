import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";

const API_BASE = "http://localhost:8000";

interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900";

const labelClass = "block text-xs font-medium text-zinc-700";

export default function Projects() {
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // form fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/projects`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed to load projects (${res.status})`);
      }
      const data: Project[] = await res.json();
      setProjects(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
    );
  }, [projects, query]);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setCreateError(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      setCreateError("Project name is required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
      };
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Create failed (${res.status})`);
      }
      const created: Project = await res.json();
      setProjects((prev) => [created, ...prev]);
      setShowCreate(false);
      resetForm();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  }, [name, description, resetForm]);

  const handleDelete = useCallback(
    async (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!confirm("Delete this project? This cannot be undone.")) return;
      setDeletingId(id);
      try {
        const res = await fetch(`${API_BASE}/api/projects/${id}`, {
          method: "DELETE",
        });
        if (!res.ok && res.status !== 204) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail ?? `Delete failed (${res.status})`);
        }
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } catch (err) {
        alert(err instanceof Error ? err.message : "Delete failed.");
      } finally {
        setDeletingId(null);
      }
    },
    []
  );

  return (
    <div className="flex min-h-screen flex-col bg-white text-sm text-zinc-900">
      <Header />

      <main className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-6 p-6">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.35rem] font-semibold tracking-tight">Projects</h1>
            <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-zinc-500">
              Create a project and add many files to it. Conversions stay together per project.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-zinc-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New Project
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="11" cy="11" r="6" />
                <path d="M15 15l4 4" strokeLinecap="round" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects…"
                className="w-[240px] rounded-md border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none"
              />
            </div>
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {filtered.length} {filtered.length === 1 ? "project" : "projects"}
            </span>
          </div>
          <button
            onClick={() => void fetchProjects()}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Refresh
          </button>
        </div>

        {/* Errors */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="flex items-start justify-between gap-3">
              <span>{error}</span>
              <button
                onClick={() => void fetchProjects()}
                className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-50"
              >
                Retry
              </button>
            </div>
            <p className="mt-2 text-xs text-red-600">
              Make sure the backend is running at <code className="rounded bg-white px-1 py-0.5">{API_BASE}</code>
            </p>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border border-zinc-200 p-4">
                <div className="h-4 w-32 rounded bg-zinc-200" />
                <div className="mt-3 h-3 w-full rounded bg-zinc-100" />
                <div className="mt-2 h-3 w-2/3 rounded bg-zinc-100" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-zinc-200">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="1.6">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
                <path d="M12 11v6M9 14h6" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-zinc-900">
              {projects.length === 0 ? "No projects yet" : "No matches"}
            </h3>
            <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-zinc-500">
              {projects.length === 0
                ? "Create your first project — then add many files at once. They’ll be converted and kept together."
                : `No projects match "${query}". Try a different search.`}
            </p>
            {projects.length === 0 && (
              <button
                onClick={() => setShowCreate(true)}
                className="mt-5 rounded-md bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-zinc-800"
              >
                Create project
              </button>
            )}
            {projects.length > 0 && query && (
              <button
                onClick={() => setQuery("")}
                className="mt-3 text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(`/project/${p.id}`)}
                className="group relative flex cursor-pointer flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/project/${p.id}`);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold leading-tight group-hover:text-zinc-900">
                        {p.name}
                      </h3>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                        {p.description || "No description"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => void handleDelete(p.id, e)}
                    disabled={deletingId === p.id}
                    className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 disabled:opacity-50"
                    title="Delete project"
                    aria-label="Delete project"
                  >
                    {deletingId === p.id ? (
                      <span className="block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 11v6M14 11v6" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
                    {p.file_count} {p.file_count === 1 ? "file" : "files"}
                  </span>
                  <span className="ml-auto text-[11px] text-zinc-400">{formatDate(p.created_at)}</span>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-100 pt-3 text-xs">
                  <span className="text-zinc-500">
                    <span className="font-medium text-zinc-900">{p.file_count}</span> files
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-zinc-900 group-hover:gap-1.5 transition-all">
                    Open
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Helper */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
          <p className="text-xs leading-relaxed text-zinc-600">
            <span className="font-semibold text-zinc-900">Tip:</span> Open a project to add many files at once — drag & drop multiple files or click to browse. They’re converted via MarkItDown and kept together in that project.
          </p>
        </div>
      </main>

      <footer className="border-t border-zinc-200 px-6 py-4 text-center text-xs text-zinc-400">
        Built by{" "}
        <a
          href="https://www.hithesh.xyz/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
        >
          hithesh.xyz
        </a>
      </footer>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" onClick={() => !creating && setShowCreate(false)} />
          <div className="relative flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">New Project</h2>
                <p className="text-xs text-zinc-500">Create a workspace for your conversions.</p>
              </div>
              <button
                onClick={() => !creating && setShowCreate(false)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>
                    Name <span className="font-normal text-red-600">*</span>
                  </span>
                  <input
                    className={inputClass}
                    placeholder="e.g. Q4 Research Papers"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    autoFocus
                  />
                  <span className="text-[11px] text-zinc-400">{name.length}/100</span>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>Description</span>
                  <textarea
                    className={`${inputClass} min-h-[72px] resize-y`}
                    placeholder="What is this project for? (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                    rows={3}
                  />
                  <span className="text-[11px] text-zinc-400">{description.length}/500</span>
                </label>

                <p className="text-xs leading-relaxed text-zinc-500">
                  Add many files after creation — you can drag & drop multiple files on the project page.
                </p>

                {createError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {createError}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-3">
              <button
                disabled={creating}
                onClick={() => {
                  setShowCreate(false);
                  resetForm();
                }}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={creating || !name.trim()}
                onClick={() => void handleCreate()}
                className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {creating && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
