import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

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
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <main className="mx-auto w-full max-w-[960px] flex-1 p-6">
          <div className="space-y-4">
            <Skeleton className="h-6 w-48" />
            <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <main className="mx-auto w-full max-w-[960px] flex-1 p-6">
          <Link to="/project" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to projects
          </Link>
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-center">
            <p className="text-sm font-medium text-destructive">{error ?? "Project not found."}</p>
            <p className="mt-1 text-xs text-destructive/80">The project may have been deleted or the ID is incorrect.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void fetchProject()}>
              Retry
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-sm text-foreground">
      <Header />

      <main className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-6 p-6">
        <Link
          to="/project"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to projects
        </Link>

        {/* Header card */}
        <Card className="overflow-hidden p-0 shadow-sm">
          <div className="h-1.5 w-full bg-primary" />
          <div className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex gap-4">
                <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:flex">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="min-w-0">
                  {editing ? (
                    <Input
                      className="max-w-[360px] text-base font-semibold"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={100}
                    />
                  ) : (
                    <h1 className="text-lg font-semibold leading-tight">{project.name}</h1>
                  )}
                  {!editing && project.description ? (
                    <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-muted-foreground">{project.description}</p>
                  ) : !editing ? (
                    <p className="mt-1 text-xs italic text-muted-foreground">No description</p>
                  ) : (
                    <Textarea
                      className="mt-2 min-h-[64px] max-w-[520px]"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Describe this project…"
                      maxLength={500}
                      rows={2}
                    />
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Created {formatDate(project.created_at)}
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    <span>Updated {formatDate(project.updated_at)}</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{project.id}</span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {!editing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => void handleDelete()} disabled={deleting}>
                      {deleting ? "Deleting…" : "Delete"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => {
                        setEditing(false);
                        setSaveError(null);
                        setEditName(project.name);
                        setEditDesc(project.description ?? "");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" disabled={saving || !editName.trim()} onClick={() => void handleSave()}>
                      {saving && <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />}
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>

            {editing && saveError && (
              <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {saveError}
              </div>
            )}

            {/* Stats row */}
            <div className="mt-6 grid grid-cols-3 gap-3 border-t pt-6">
              <div className="rounded-lg bg-muted/40 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Files</div>
                <div className="mt-1 text-xl font-semibold">{project.file_count}</div>
                <div className="text-xs text-muted-foreground">in this project</div>
              </div>
              <div className="rounded-lg bg-muted/40 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last updated</div>
                <div className="mt-1 text-sm font-semibold">{formatDate(project.updated_at).split(",")[0]}</div>
                <div className="text-xs text-muted-foreground">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} stored` : "No files yet"}</div>
              </div>
              <div className="rounded-lg bg-muted/40 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</div>
                <Badge className="mt-1 gap-1.5 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Active
                </Badge>
                <div className="mt-1 text-xs text-muted-foreground">Ready for uploads</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Files section — many files */}
        <Card className="p-0 shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Files</h2>
              <p className="text-xs text-muted-foreground">Add many files at once — they’ll be converted with MarkItDown and kept here.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading…" : "Add files"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void fetchFiles()}>
                Refresh
              </Button>
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
                isDragging ? "border-solid border-foreground bg-muted/40" : "hover:border-foreground hover:bg-muted/40"
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
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {uploading ? "Converting files…" : "Drop files here or click to browse"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Supports PDF, DOCX, PPTX, HTML, CSV, images, etc. — up to 20 files, 25 MB each</p>
              </div>
              {uploading && <span className="mt-2 h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />}
            </div>

            {uploadError && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{uploadError}</div>
            )}
            {filesError && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {filesError}{" "}
                <Button variant="link" size="sm" className="ml-2 h-auto p-0 text-xs" onClick={() => void fetchFiles()}>
                  Retry
                </Button>
              </div>
            )}

            {/* Files list */}
            <div className="mt-6">
              {filesLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="space-y-2 rounded-lg border p-4">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ))}
                </div>
              ) : files.length === 0 ? (
                <div className="rounded-lg border bg-muted/30 px-6 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">No files in this project yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">Add many files above — they’ll appear here with preview, copy & download.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(files.reduce((a, f) => a + f.chars, 0))} total
                    </span>
                    <span className="hidden sm:inline">Click a file to expand preview</span>
                  </div>
                  {files.map((f) => (
                    <div key={f.id} className="overflow-hidden rounded-lg border bg-card">
                      <div
                        className="flex cursor-pointer items-start justify-between gap-3 px-4 py-3 hover:bg-muted/40"
                        onClick={() => setExpandedId((prev) => (prev === f.id ? null : f.id))}
                      >
                        <div className="flex min-w-0 gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <path d="M7 3h6l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                              <path d="M13 3v5h5" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium leading-tight">{f.filename}</div>
                            {f.title && <div className="truncate text-xs text-muted-foreground">{f.title}</div>}
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span>{formatBytes(f.chars)}</span>
                              <span>·</span>
                              <span>{formatDate(f.created_at)}</span>
                              <span className="hidden font-mono sm:inline">· {f.id}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <Button variant="outline" size="sm" onClick={() => handleCopy(f.markdown)}>
                            Copy
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleDownload(f)}>
                            Download
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void handleDeleteFile(f.id)}
                            className="text-muted-foreground hover:text-destructive"
                            title="Delete file"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </Button>
                        </div>
                      </div>
                      {expandedId === f.id && (
                        <div className="border-t bg-muted/30">
                          <pre className="m-0 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12.5px] leading-relaxed text-foreground/90">
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
        </Card>

        {/* Danger zone */}
        {!editing && (
          <Card className="border-destructive/30 bg-destructive/5 p-4 shadow-none">
            <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
            <p className="mt-1 text-xs leading-relaxed text-destructive/80">
              Deleting a project permanently removes its metadata and all stored file previews.
            </p>
            <Button
              variant="destructive"
              size="sm"
              className="mt-3"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              Delete &quot;{project.name}&quot;
            </Button>
          </Card>
        )}
      </main>

      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
        Built by{" "}
        <a
          href="https://www.hithesh.xyz/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground/70 underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          hithesh.xyz
        </a>
      </footer>
    </div>
  );
}
