import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "http://localhost:8000";

type ChunkStrategy = "character" | "recursive" | "token";
type Mode = "convert" | "chunk";
type ViewMode = "markdown" | "chunks" | "json";

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

const tabButton = (active: boolean) =>
  `px-3 py-1.5 rounded-md text-[13px] transition-colors ${
    active
      ? "bg-white text-zinc-900 shadow-sm"
      : "text-zinc-500 hover:text-zinc-900"
  }`;

const viewToggleButton = (active: boolean) =>
  `px-2.5 py-1.5 text-[13px] border-r border-zinc-200 last:border-r-0 transition-colors ${
    active ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"
  }`;

const chunkListItem = (active: boolean) =>
  `flex w-full items-baseline gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
    active ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100"
  }`;

const inputClass =
  "min-w-[130px] rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-indigo-600 focus:outline-none";

const ghostButton =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 transition-colors hover:bg-zinc-100";

function App() {
  const [mode, setMode] = useState<Mode>("convert");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);

  const [chunkStrategy, setChunkStrategy] = useState<ChunkStrategy>("recursive");
  const [chunkSize, setChunkSize] = useState(1000);
  const [chunkOverlap, setChunkOverlap] = useState(200);
  const [chunkModel, setChunkModel] = useState("");

  const [viewMode, setViewMode] = useState<ViewMode>("markdown");
  const [selectedChunk, setSelectedChunk] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Conversion failed.");
      } finally {
        setIsLoading(false);
      }
    },
    [mode, chunkStrategy, chunkSize, chunkOverlap, chunkModel]
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
    <div className="flex min-h-screen flex-col bg-white text-sm text-zinc-900">
      <div className="flex items-center gap-4 border-b border-zinc-200 px-6 py-3.5">
        <span className="text-[0.95rem] font-semibold tracking-tight">Momo</span>
      </div>

      <main className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
            <button className={tabButton(mode === "convert")} onClick={() => setMode("convert")}>
              Convert
            </button>
            <button className={tabButton(mode === "chunk")} onClick={() => setMode("chunk")}>
              Convert + Chunk
            </button>
          </div>

          {mode === "chunk" && (
            <>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                <span>Strategy</span>
                <select
                  className={inputClass}
                  value={chunkStrategy}
                  onChange={(e) => setChunkStrategy(e.target.value as ChunkStrategy)}
                >
                  <option value="character">Character</option>
                  <option value="recursive">Recursive</option>
                  <option value="token">Token</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                <span>Chunk size</span>
                <input
                  className={`${inputClass} w-24 min-w-0`}
                  type="number"
                  min={1}
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                <span>Overlap</span>
                <input
                  className={`${inputClass} w-24 min-w-0`}
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
          <section className="flex flex-wrap gap-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3.5">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              <span>Model</span>
              <input
                className={inputClass}
                type="text"
                placeholder="gpt-4o"
                value={chunkModel}
                onChange={(e) => setChunkModel(e.target.value)}
              />
            </label>
          </section>
        )}

        <div
          className={`flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed text-center text-zinc-500 transition-colors hover:border-black hover:bg-zinc-50 ${
            isDragging ? "border-solid border-black bg-zinc-50" : "border-zinc-300"
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
            className="text-zinc-400"
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

        <button
          className="self-start rounded-md bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
          disabled={!selectedFile || isLoading}
          onClick={handleConvertClick}
        >
          Momo
        </button>

        {error && (
          <div className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
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
                <div className="flex gap-2.5 text-xs text-zinc-500">
                  {stats.map((s, i) => (
                    <span key={s}>
                      {i > 0 && <span className="mr-2.5 text-zinc-400">·</span>}
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {result.chunks && (
                  <div className="flex overflow-hidden rounded-md border border-zinc-200">
                    <button
                      className={viewToggleButton(viewMode === "markdown")}
                      onClick={() => setViewMode("markdown")}
                    >
                      Markdown
                    </button>
                    <button
                      className={viewToggleButton(viewMode === "chunks")}
                      onClick={() => setViewMode("chunks")}
                    >
                      Chunks
                    </button>
                    <button
                      className={viewToggleButton(viewMode === "json")}
                      onClick={() => setViewMode("json")}
                    >
                      JSON
                    </button>
                  </div>
                )}
                <button className={ghostButton} onClick={handleCopy}>
                  Copy
                </button>
                <button className={ghostButton} onClick={handleDownload}>
                  Download
                </button>
              </div>
            </div>

            {(viewMode === "markdown" || !result.chunks) && (
              <pre className="m-0 max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-[13px] leading-relaxed text-zinc-900">
                {result.markdown}
              </pre>
            )}

            {viewMode === "chunks" && result.chunks && (
              <div className="grid h-[65vh] grid-cols-[220px_1fr] gap-3">
                <div className="flex flex-col gap-0.5 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-1">
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
                      <div className="flex flex-wrap gap-3.5 text-xs text-zinc-500">
                        {Object.entries(result.chunks[selectedChunk].metadata).map(([k, v]) => (
                          <span key={k}>
                            <b className="mr-1 font-medium text-zinc-400">{k}</b>
                            {String(v)}
                          </span>
                        ))}
                      </div>
                      <pre className="m-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-[13px] leading-relaxed text-zinc-900">
                        {result.chunks[selectedChunk].text}
                      </pre>
                    </>
                  )}
                </div>
              </div>
            )}

            {viewMode === "json" && result.chunks && (
              <pre className="m-0 max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-[13px] leading-relaxed text-zinc-900">
                {JSON.stringify(result.chunks, null, 2)}
              </pre>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
