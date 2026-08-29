import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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

interface ProjectFile {
  id: string;
  filename: string;
  title: string | null;
  markdown: string;
  created_at: string;
  chars: number;
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
function formatBytes(n: number): string {
  if (n < 1000) return `${n} chars`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // files
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed to load project (${res.status})`);
      }
      const data: Project = await res.json();
      setProject(data);
      setEditName(data.name);
      setEditDesc(data.description ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchFiles = useCallback(async () => {
    if (!id) return;
    setFilesLoading(true);
    setFilesError(null);
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/files`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed to load files (${res.status})`);
      }
      const data: ProjectFile[] = await res.json();
      setFiles(data);
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : "Failed to load files.");
    } finally {
      setFilesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchProject();
    void fetchFiles();
  }, [fetchProject, fetchFiles]);

  const handleSave = useCallback(async () => {
    if (!id || !project) return;
    if (!editName.trim()) {
      setSaveError("Project name is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Save failed (${res.status})`);
      }
      const updated: Project = await res.json();
      setProject(updated);
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [id, project, editName, editDesc]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    if (!confirm("Delete this project? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Delete failed (${res.status})`);
      }
      navigate("/project");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed.");
      setDeleting(false);
    }
  }, [id, navigate]);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (!id) return;
      const arr = Array.from(fileList);
      if (arr.length === 0) return;
      if (arr.length > 20) {
        setUploadError("You can upload up to 20 files at once.");
        return;
      }
      setUploading(true);
      setUploadError(null);
      try {
        const fd = new FormData();
        arr.forEach((f) => fd.append("files", f));
        const res = await fetch(`${API_BASE}/api/projects/${id}/files`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail ?? `Upload failed (${res.status})`);
        }
        const created: ProjectFile[] = await res.json();
        setFiles((prev) => [...created, ...prev]);
        setProject((prev) => (prev ? { ...prev, file_count: (prev.file_count || 0) + created.length } : prev));
        // also refetch project to sync timestamps
        void fetchProject();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [id, fetchProject]
  );

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      if (!id) return;
      if (!confirm("Delete this file?")) return;
      try {
        const res = await fetch(`${API_BASE}/api/projects/${id}/files/${fileId}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail ?? `Delete failed (${res.status})`);
        }
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
        setProject((prev) => (prev ? { ...prev, file_count: Math.max(0, prev.file_count - 1) } : prev));
      } catch (e) {
        alert(e instanceof Error ? e.message : "Delete failed.");
      }
    },
    [id]
  );

  const handleCopy = useCallback((md: string) => {
    void navigator.clipboard.writeText(md);
  }, []);

  const handleDownload = useCallback((f: ProjectFile) => {
    const base = f.filename.replace(/\.[^/.]+$/, "");
    const blob = new Blob([f.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header />
        <main className="mx-auto w-full max-w-[960px] flex-1 p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-6 w-48 rounded bg-zinc-200" />
            <div className="h-24 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="h-4 w-32 rounded bg-zinc-200" />
              <div className="mt-3 h-3 w-full rounded bg-zinc-100" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <Header />
        <main className="mx-auto w-full max-w-[960px] flex-1 p-6">
          <Link to="/project" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to projects
          </Link>
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-red-800">{error ?? "Project not found."}</p>
            <p className="mt-1 text-xs text-red-600">The project may have been deleted or the ID is incorrect.</p>
            <button
              onClick={() => void fetchProject()}
              className="mt-4 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-sm text-zinc-900">
      <Header />

      <main className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-6 p-6">
        <Link
          to="/project"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to projects
        </Link>

        {/* Header card */}
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="h-1.5 w-full bg-zinc-900" />
          <div className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex gap-4">
                <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white sm:flex">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="min-w-0">
                  {editing ? (
                    <input
                      className={`${inputClass} max-w-[360px] text-base font-semibold`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={100}
                    />
                  ) : (
                    <h1 className="text-lg font-semibold leading-tight">{project.name}</h1>
                  )}
                  {!editing && project.description ? (
                    <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-zinc-500">{project.description}</p>
                  ) : !editing ? (
                    <p className="mt-1 text-xs italic text-zinc-400">No description</p>
                  ) : (
                    <textarea
                      className={`${inputClass} mt-2 min-h-[64px] max-w-[520px]`}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Describe this project…"
                      maxLength={500}
                      rows={2}
                    />
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Created {formatDate(project.created_at)}
                    </span>
                    <span className="text-zinc-300">·</span>
                    <span>Updated {formatDate(project.updated_at)}</span>
                    <span className="text-zinc-300">·</span>
                    <span className="font-mono text-[11px] text-zinc-400">{project.id}</span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {!editing ? (
                  <>
                    <button
                      onClick={() => setEditing(true)}
                      className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleDelete()}
                      disabled={deleting}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={saving}
                      onClick={() => {
                        setEditing(false);
                        setSaveError(null);
                        setEditName(project.name);
                        setEditDesc(project.description ?? "");
                      }}
                      className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={saving || !editName.trim()}
                      onClick={() => void handleSave()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {saving && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                      Save
                    </button>
                  </>
                )}
              </div>
            </div>

            {editing && saveError && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {saveError}
              </div>
            )}

            {/* Stats row */}
            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-zinc-100 pt-6">
              <div className="rounded-lg bg-zinc-50 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Files</div>
                <div className="mt-1 text-xl font-semibold">{project.file_count}</div>
                <div className="text-xs text-zinc-500">in this project</div>
              </div>
              <div className="rounded-lg bg-zinc-50 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Last updated</div>
                <div className="mt-1 text-sm font-semibold">{formatDate(project.updated_at).split(",")[0]}</div>
                <div className="text-xs text-zinc-500">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} stored` : "No files yet"}</div>
              </div>
              <div className="rounded-lg bg-zinc-50 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Status</div>
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Active
                </div>
                <div className="mt-1 text-xs text-zinc-500">Ready for uploads</div>
              </div>
            </div>
          </div>
        </div>

        {/* Files section — many files */}
        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Files</h2>
              <p className="text-xs text-zinc-500">Add many files at once — they’ll be converted with MarkItDown and kept here.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Add files"}
              </button>
              <button
                onClick={() => void fetchFiles()}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="p-5">
            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const list = e.dataTransfer.files;
                if (list && list.length) void uploadFiles(list);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
                isDragging ? "border-solid border-zinc-900 bg-zinc-50" : "border-zinc-300 hover:border-zinc-900 hover:bg-zinc-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {uploading ? "Converting files…" : "Drop files here or click to browse"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Supports PDF, DOCX, PPTX, HTML, CSV, images, etc. — up to 20 files, 25 MB each</p>
              </div>
              {uploading && <span className="mt-2 h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />}
            </div>

            {uploadError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</div>
            )}
            {filesError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {filesError}{" "}
                <button onClick={() => void fetchFiles()} className="ml-2 text-xs font-medium underline">
                  Retry
                </button>
              </div>
            )}

            {/* Files list */}
            <div className="mt-6">
              {filesLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="animate-pulse rounded-lg border border-zinc-200 p-4">
                      <div className="h-4 w-32 rounded bg-zinc-200" />
                      <div className="mt-2 h-3 w-2/3 rounded bg-zinc-100" />
                    </div>
                  ))}
                </div>
              ) : files.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-10 text-center">
                  <p className="text-sm font-medium text-zinc-900">No files in this project yet</p>
                  <p className="mt-1 text-xs text-zinc-500">Add many files above — they’ll appear here with preview, copy & download.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>
                      {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(files.reduce((a, f) => a + f.chars, 0))} total
                    </span>
                    <span className="hidden sm:inline">Click a file to expand preview</span>
                  </div>
                  {files.map((f) => (
                    <div key={f.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
                      <div
                        className="flex cursor-pointer items-start justify-between gap-3 px-4 py-3 hover:bg-zinc-50"
                        onClick={() => setExpandedId((prev) => (prev === f.id ? null : f.id))}
                      >
                        <div className="flex min-w-0 gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <path d="M7 3h6l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                              <path d="M13 3v5h5" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium leading-tight">{f.filename}</div>
                            {f.title && <div className="truncate text-xs text-zinc-500">{f.title}</div>}
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                              <span>{formatBytes(f.chars)}</span>
                              <span>·</span>
                              <span>{formatDate(f.created_at)}</span>
                              <span className="hidden font-mono sm:inline">· {f.id}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleCopy(f.markdown)}
                            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                          >
                            Copy
                          </button>
                          <button
                            onClick={() => handleDownload(f)}
                            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => void handleDeleteFile(f.id)}
                            className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                            title="Delete file"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {expandedId === f.id && (
                        <div className="border-t border-zinc-200 bg-zinc-50">
                          <pre className="m-0 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12.5px] leading-relaxed text-zinc-800">
                            {f.markdown || "(no text extracted)"}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Danger zone */}
        {!editing && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="text-sm font-semibold text-red-900">Danger zone</h3>
            <p className="mt-1 text-xs leading-relaxed text-red-700">
              Deleting a project permanently removes its metadata and all stored file previews.
            </p>
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="mt-3 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-50"
            >
              Delete &quot;{project.name}&quot;
            </button>
          </div>
        )}
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
    </div>
  );
}
