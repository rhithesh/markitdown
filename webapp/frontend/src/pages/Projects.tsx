import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
    <div className="flex min-h-screen flex-col bg-background text-sm text-foreground">
      <Header />

      <main className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-6 p-6">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.35rem] font-semibold tracking-tight">Projects</h1>
            <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-muted-foreground">
              Create a project and add many files to it. Conversions stay together per project.
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New Project
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="11" cy="11" r="6" />
                <path d="M15 15l4 4" strokeLinecap="round" />
              </svg>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects…"
                className="w-[240px] pl-8"
              />
            </div>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {filtered.length} {filtered.length === 1 ? "project" : "projects"}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchProjects()}>
            Refresh
          </Button>
        </div>

        {/* Errors */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <div className="flex items-start justify-between gap-3">
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void fetchProjects()}
              >
                Retry
              </Button>
            </div>
            <p className="mt-2 text-xs text-destructive/80">
              Make sure the backend is running at <code className="rounded bg-background px-1 py-0.5">{API_BASE}</code>
            </p>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-3 rounded-xl border p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-muted-foreground">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
                <path d="M12 11v6M9 14h6" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-foreground">
              {projects.length === 0 ? "No projects yet" : "No matches"}
            </h3>
            <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
              {projects.length === 0
                ? "Create your first project — then add many files at once. They’ll be converted and kept together."
                : `No projects match "${query}". Try a different search.`}
            </p>
            {projects.length === 0 && (
              <Button className="mt-5" onClick={() => setShowCreate(true)}>
                Create project
              </Button>
            )}
            {projects.length > 0 && query && (
              <Button variant="link" className="mt-3" onClick={() => setQuery("")}>
                Clear search
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(`/project/${p.id}`)}
                className="group relative flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-foreground/20 hover:shadow-md"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/project/${p.id}`);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold leading-tight group-hover:text-foreground">
                        {p.name}
                      </h3>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {p.description || "No description"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => void handleDelete(p.id, e)}
                    disabled={deletingId === p.id}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title="Delete project"
                    aria-label="Delete project"
                  >
                    {deletingId === p.id ? (
                      <span className="block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 11v6M14 11v6" strokeLinecap="round" />
                      </svg>
                    )}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">
                    {p.file_count} {p.file_count === 1 ? "file" : "files"}
                  </Badge>
                  <span className="ml-auto text-[11px] text-muted-foreground">{formatDate(p.created_at)}</span>
                </div>

                <div className="flex items-center justify-between border-t pt-3 text-xs">
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">{p.file_count}</span> files
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-foreground transition-all group-hover:gap-1.5">
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
        <div className="rounded-lg border bg-muted/40 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Tip:</span> Open a project to add many files at once — drag & drop multiple files or click to browse. They’re converted via MarkItDown and kept together in that project.
          </p>
        </div>
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

      {/* Create dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          if (!open && creating) return;
          setShowCreate(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>Create a workspace for your conversions.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">
                Name <span className="font-normal text-destructive">*</span>
              </Label>
              <Input
                id="project-name"
                placeholder="e.g. Q4 Research Papers"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                autoFocus
              />
              <span className="text-[11px] text-muted-foreground">{name.length}/100</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                placeholder="What is this project for? (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
              />
              <span className="text-[11px] text-muted-foreground">{description.length}/500</span>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Add many files after creation — you can drag & drop multiple files on the project page.
            </p>

            {createError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={creating}
              onClick={() => {
                setShowCreate(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button disabled={creating || !name.trim()} onClick={() => void handleCreate()}>
              {creating && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
