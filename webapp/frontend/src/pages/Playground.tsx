import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const API_BASE = "http://localhost:8000";

type ChunkStrategy = "character" | "recursive" | "token";
type Mode = "convert" | "chunk";
type ViewMode = "markdown" | "chunks" | "json";

interface ModelSearchResult {
  id: string;
  downloads: number | null;
}

interface ModelSearchResponse {
  openai: string[];
  huggingface: ModelSearchResult[];
}

function formatDownloads(n: number | null): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M downloads`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k downloads`;
  return `${n} downloads`;
}

interface Chunk {
  text: string;
  metadata: Record<string, unknown>;
}

interface ConvertResponse {
  filename: string;
  title: string | null;
  markdown: string;
  chunks: Chunk[] | null;
}

function formatBytes(n: number): string {
  if (n < 1000) return `${n} chars`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${(n / 1_000_000).toFixed(1)}M chars`;
}

const chunkListItem = (active: boolean) =>
  `flex w-full items-baseline gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
  }`;

function Playground() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");

  const [mode, setMode] = useState<Mode>("convert");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);

  const [chunkStrategy, setChunkStrategy] = useState<ChunkStrategy>("recursive");
  const [chunkSize, setChunkSize] = useState(1000);
  const [chunkOverlap, setChunkOverlap] = useState(200);
  const [chunkModel, setChunkModel] = useState("");

  const [tokenizerStatus, setTokenizerStatus] = useState<
    "idle" | "checking" | "valid" | "invalid"
  >("idle");
  const [tokenizerMessage, setTokenizerMessage] = useState<string | null>(null);

  const [modelResults, setModelResults] = useState<ModelSearchResponse>({
    openai: [],
    huggingface: [],
  });
  const [modelSearchLoading, setModelSearchLoading] = useState(false);
  const [modelListOpen, setModelListOpen] = useState(false);
  // Tracks a value just chosen from the suggestion list so the search effect
  // below can skip re-querying it as free text -- searching a full repo id
  // like "google-bert/bert-base-uncased" as a fuzzy string surfaces noisy
  // near-duplicate forks instead of the handful of results the user already saw.
  const lastSelectedModelRef = useRef<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("markdown");
  const [selectedChunk, setSelectedChunk] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // If ?project= is present, fetch project defaults and prefill
  useEffect(() => {
    if (!projectId) {
      setProjectName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/projects/${projectId}`);
        if (!res.ok) throw new Error();
        const p = await res.json();
        if (cancelled) return;
        setProjectName(p.name);
        if (p.chunk_strategy) {
          setChunkStrategy(p.chunk_strategy as ChunkStrategy);
          setMode("chunk");
        }
        if (p.chunk_size) setChunkSize(p.chunk_size);
        if (typeof p.chunk_overlap === "number") setChunkOverlap(p.chunk_overlap);
        if (p.chunk_model) {
          lastSelectedModelRef.current = p.chunk_model;
          setChunkModel(p.chunk_model);
        }
        setProjectNotice(`Loaded defaults from “${p.name}”`);
        // auto-clear notice after 4s
        setTimeout(() => {
          if (!cancelled) setProjectNotice(null);
        }, 4000);
      } catch {
        if (!cancelled) setProjectName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Debounced check that the entered model name has a resolvable tokenizer
  // (tiktoken or Hugging Face) before the user hits convert.
  useEffect(() => {
    if (mode !== "chunk" || chunkStrategy !== "token" || !chunkModel.trim()) {
      setTokenizerStatus("idle");
      setTokenizerMessage(null);
      return;
    }
    let cancelled = false;
    setTokenizerStatus("checking");
    setTokenizerMessage(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/tokenizer-check?model=${encodeURIComponent(chunkModel.trim())}`
        );
        const data = await res.json();
        if (cancelled) return;
        setTokenizerStatus(data.valid ? "valid" : "invalid");
        setTokenizerMessage(data.message);
      } catch {
        if (!cancelled) {
          setTokenizerStatus("idle");
          setTokenizerMessage(null);
        }
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, chunkStrategy, chunkModel]);

  // Debounced model-name search against the backend (tiktoken presets +
  // live Hugging Face lookup) to populate suggestions as the user types.
  useEffect(() => {
    if (mode !== "chunk" || chunkStrategy !== "token") {
      setModelResults({ openai: [], huggingface: [] });
      return;
    }
    const query = chunkModel.trim();
    // Just picked this exact value from the list below -- leave the results
    // as they were rather than re-searching the full id as free text.
    if (query && query === lastSelectedModelRef.current) {
      return;
    }
    let cancelled = false;
    setModelSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/model-search?q=${encodeURIComponent(query)}&limit=8`
        );
        const data: ModelSearchResponse = await res.json();
        if (!cancelled) setModelResults(data);
      } catch {
        if (!cancelled) setModelResults({ openai: [], huggingface: [] });
      } finally {
        if (!cancelled) setModelSearchLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, chunkStrategy, chunkModel]);

  const convertFile = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setError(null);
      setResult(null);
      setSelectedChunk(0);

      const formData = new FormData();
      formData.append("file", file);
      // Plain "convert" mode never sends chunking params, regardless of
      // whatever strategy might be selected from a previous "chunk" mode visit.
      if (mode === "chunk" && chunkStrategy) {
        formData.append("chunk_strategy", chunkStrategy);
        formData.append("chunk_size", String(chunkSize));
        formData.append("chunk_overlap", String(chunkOverlap));
        if (chunkStrategy === "token" && chunkModel.trim()) {
          formData.append("chunk_model", chunkModel.trim());
        }
      }

      try {
        const response = await fetch(`${API_BASE}/api/convert`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(
            body?.detail ?? `Request failed with status ${response.status}`
          );
        }

        const data: ConvertResponse = await response.json();
        setResult(data);
        setViewMode(data.chunks ? "chunks" : "markdown");
        // If inside a project, bump its file_count / updated_at
        if (projectId) {
          void fetch(`${API_BASE}/api/projects/${projectId}/touch`, { method: "POST" }).catch(() => {});
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Conversion failed.");
      } finally {
        setIsLoading(false);
      }
    },
    [mode, chunkStrategy, chunkSize, chunkOverlap, chunkModel, projectId]
  );

  const selectFile = useCallback((file: File) => {
    setSelectedFile(file);
    setResult(null);
    setError(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) selectFile(file);
    },
    [selectFile]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) selectFile(file);
      e.target.value = "";
    },
    [selectFile]
  );

  const handleConvertClick = useCallback(() => {
    if (selectedFile) void convertFile(selectedFile);
  }, [selectedFile, convertFile]);

  const handleCopy = useCallback(() => {
    if (!result) return;
    const text =
      viewMode === "json" && result.chunks
        ? JSON.stringify(result.chunks, null, 2)
        : result.markdown;
    void navigator.clipboard.writeText(text);
  }, [result, viewMode]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const base = result.filename.replace(/\.[^/.]+$/, "");
    const isJson = viewMode === "json" && result.chunks;
    const blob = new Blob(
      [isJson ? JSON.stringify(result.chunks, null, 2) : result.markdown],
      { type: isJson ? "application/json" : "text/markdown;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isJson ? `${base}.chunks.json` : `${base}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, viewMode]);

  // Keep the selected chunk in range if a new (smaller) result comes in.
  useEffect(() => {
    if (result?.chunks && selectedChunk >= result.chunks.length) {
      setSelectedChunk(0);
    }
  }, [result, selectedChunk]);

  const pageCount = result?.chunks
    ? new Set(
        result.chunks
          .map((c) => c.metadata.page_no)
          .filter((p) => p !== null && p !== undefined)
      ).size
    : 0;

  const stats = result
    ? [
        formatBytes(result.markdown.length),
        result.chunks ? `${result.chunks.length} chunks` : null,
        pageCount > 0 ? `${pageCount} pages` : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="flex min-h-screen flex-col bg-background text-sm text-foreground">
      <Header />

      <main className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-4 p-6">
        {/* Project context banner */}
        {projectId && projectName && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-foreground/10">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
                </svg>
              </span>
              <div>
                <div className="text-xs font-medium leading-none">Project: {projectName}</div>
                <div className="text-[11px] leading-none text-primary-foreground/70">Defaults pre-filled from project settings</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" asChild>
                <Link to={`/project/${projectId}`}>View project</Link>
              </Button>
              <Button size="sm" variant="outline" className="border-primary-foreground/20 bg-transparent text-primary-foreground hover:bg-primary-foreground/10" asChild>
                <Link to="/playground">Clear</Link>
              </Button>
            </div>
          </div>
        )}
        {projectId && !projectName && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            Project <span className="font-mono">{projectId}</span> not found — using global defaults.{" "}
            <Link to="/project" className="font-medium underline hover:text-amber-900">
              Browse projects
            </Link>
          </div>
        )}
        {projectNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {projectNotice}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="convert">Convert</TabsTrigger>
              <TabsTrigger value="chunk">Convert + Chunk</TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === "chunk" && (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Strategy</span>
                <Select value={chunkStrategy} onValueChange={(v) => setChunkStrategy(v as ChunkStrategy)}>
                  <SelectTrigger size="sm" className="min-w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="character">Character</SelectItem>
                    <SelectItem value="recursive">Recursive</SelectItem>
                    <SelectItem value="token">Token</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Chunk size</span>
                <Input
                  className="w-24 min-w-0"
                  type="number"
                  min={1}
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Overlap</span>
                <Input
                  className="w-24 min-w-0"
                  type="number"
                  min={0}
                  value={chunkOverlap}
                  onChange={(e) => setChunkOverlap(Number(e.target.value))}
                />
              </label>
            </>
          )}
        </div>

        {mode === "chunk" && chunkStrategy === "token" && (
          <section className="flex flex-wrap gap-5 rounded-lg border  px-4 py-3.5">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Model</span>
              <Command
                shouldFilter={false}
                className="relative w-[380px] overflow-visible   bg-transparent "
              >
                <CommandInput
                  placeholder="Search or type a model name…"
                  value={chunkModel}
                  onValueChange={(v) => {
                    setChunkModel(v);
                    setModelListOpen(true);
                  }}
                  onFocus={() => setModelListOpen(true)}
                  onClick={() => setModelListOpen(true)}
                  onBlur={() => setTimeout(() => setModelListOpen(false), 150)}
                  aria-invalid={tokenizerStatus === "invalid"}
                />
                {modelListOpen && (
                  <CommandList className="absolute inset-x-0 top-full z-50 mt-1 rounded-lg border bg-popover shadow-md">
                    {modelSearchLoading && (
                      <div className="flex items-center gap-1.5 px-2 py-3 text-xs text-muted-foreground">
                        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                        Searching…
                      </div>
                    )}
                    {!modelSearchLoading &&
                      modelResults.openai.length === 0 &&
                      modelResults.huggingface.length === 0 && (
                        <CommandEmpty>
                          No matching models — your typed name will be used as-is.
                        </CommandEmpty>
                      )}
                    {modelResults.openai.length > 0 && (
                      <CommandGroup heading="OpenAI (tiktoken)">
                        {modelResults.openai.map((id) => (
                          <CommandItem
                            key={id}
                            value={id}
                            onSelect={(v) => {
                              lastSelectedModelRef.current = v;
                              setChunkModel(v);
                              setModelListOpen(false);
                            }}
                            data-checked={chunkModel === id}
                          >
                            {id}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {modelResults.huggingface.length > 0 && (
                      <CommandGroup heading="Hugging Face">
                        {modelResults.huggingface.map((m) => (
                          <CommandItem
                            key={m.id}
                            value={m.id}
                            onSelect={(v) => {
                              lastSelectedModelRef.current = v;
                              setChunkModel(v);
                              setModelListOpen(false);
                            }}
                            data-checked={chunkModel === m.id}
                          >
                            <span className="truncate">{m.id}</span>
                            {formatDownloads(m.downloads) && (
                              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                                {formatDownloads(m.downloads)}
                              </span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                )}
              </Command>
            </label>
          </section>
        )}

        <div
          className={`flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed text-center text-muted-foreground transition-colors hover:border-foreground hover:bg-muted/40 ${
            isDragging ? "border-solid border-foreground bg-muted/40" : ""
          } ${result ? "flex-row gap-2 px-4 py-2.5" : "px-6 py-11"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <input ref={fileInputRef} type="file" hidden onChange={handleFileInputChange} />
          <svg
            className="text-muted-foreground"
            width={result ? 16 : 20}
            height={result ? 16 : 20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path
              d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className={result ? "text-[0.8rem]" : "text-[0.85rem]"}>
            {isLoading
              ? "Converting…"
              : result
              ? "Drop another file, or click to browse"
              : selectedFile
              ? `Selected: ${selectedFile.name}`
              : "Drop a file here, or click to browse to get started"}
          </p>
        </div>

        <Button
          className="self-start"
          disabled={!selectedFile || isLoading || tokenizerStatus === "invalid"}
          onClick={handleConvertClick}
          title={tokenizerStatus === "invalid" ? tokenizerMessage ?? undefined : undefined}
        >
          Momo
        </Button>

        {error && (
          <div className="whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && result.markdown.trim().length === 0 && (
          <section className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3.5">
            <h2 className="text-sm font-semibold text-amber-900">
              {result.filename}: no text found
            </h2>
            <p className="text-[13px] text-amber-800">
              This file converted successfully but produced no extractable
              text. This usually means it's a scanned or image-only PDF (a
              photographed/scanned document with no real text layer) —
              markitdown can't extract text that isn't actually there without
              OCR, which isn't enabled in this tool right now.
            </p>
          </section>
        )}

        {result && result.markdown.trim().length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="mb-1 break-words text-base font-semibold">
                  {result.title || result.filename}
                </h2>
                <div className="flex gap-2.5 text-xs text-muted-foreground">
                  {stats.map((s, i) => (
                    <span key={s}>
                      {i > 0 && <span className="mr-2.5 text-muted-foreground/50">·</span>}
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {result.chunks && (
                  <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                    <TabsList>
                      <TabsTrigger value="markdown">Markdown</TabsTrigger>
                      <TabsTrigger value="chunks">Chunks</TabsTrigger>
                      <TabsTrigger value="json">JSON</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  Copy
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  Download
                </Button>
              </div>
            </div>

            {(viewMode === "markdown" || !result.chunks) && (
              <pre className="m-0 max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-4 font-mono text-[13px] leading-relaxed text-foreground">
                {result.markdown}
              </pre>
            )}

            {viewMode === "chunks" && result.chunks && (
              <div className="grid h-[65vh] grid-cols-[220px_1fr] gap-3">
                <div className="flex flex-col gap-0.5 overflow-y-auto rounded-lg border bg-muted/40 p-1">
                  {result.chunks.map((chunk, i) => (
                    <button
                      key={i}
                      className={chunkListItem(i === selectedChunk)}
                      onClick={() => setSelectedChunk(i)}
                    >
                      <span className="shrink-0 font-mono text-[11px] opacity-60">{i}</span>
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                        {chunk.text.slice(0, 60).replace(/\s+/g, " ")}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  {result.chunks[selectedChunk] && (
                    <>
                      <div className="flex flex-wrap gap-3.5 text-xs text-muted-foreground">
                        {Object.entries(result.chunks[selectedChunk].metadata).map(([k, v]) => (
                          <span key={k}>
                            <b className="mr-1 font-medium text-muted-foreground/70">{k}</b>
                            {String(v)}
                          </span>
                        ))}
                      </div>
                      <pre className="m-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-4 font-mono text-[13px] leading-relaxed text-foreground">
                        {result.chunks[selectedChunk].text}
                      </pre>
                    </>
                  )}
                </div>
              </div>
            )}

            {viewMode === "json" && result.chunks && (
              <pre className="m-0 max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-4 font-mono text-[13px] leading-relaxed text-foreground">
                {JSON.stringify(result.chunks, null, 2)}
              </pre>
            )}
          </section>
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

export default Playground;
