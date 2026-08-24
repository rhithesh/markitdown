import { useCallback, useRef, useState } from "react";
import "./App.css";

const API_BASE = "http://localhost:8000";

type ChunkStrategy = "" | "character" | "recursive" | "token";

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

type Mode = "convert" | "chunk";

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

  const [viewMode, setViewMode] = useState<"markdown" | "chunks" | "json">(
    "markdown"
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const convertFile = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setError(null);
      setResult(null);

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

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void convertFile(file);
    },
    [convertFile]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void convertFile(file);
      e.target.value = "";
    },
    [convertFile]
  );

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

  return (
    <div className="app">
      <header className="header">
        <h1>MarkItDown</h1>
        <p>
          {mode === "convert"
            ? "Drop a file to convert it to Markdown, using the local markitdown package."
            : "Drop a file to convert it to Markdown and split it into chunks."}
        </p>
      </header>

      <div className="mode-tabs">
        <button
          className={mode === "convert" ? "active" : ""}
          onClick={() => setMode("convert")}
        >
          Convert
        </button>
        <button
          className={mode === "chunk" ? "active" : ""}
          onClick={() => setMode("chunk")}
        >
          Convert + Chunk
        </button>
      </div>

      {mode === "chunk" && (
        <section className="options">
          <label>
            Chunking strategy
            <select
              value={chunkStrategy}
              onChange={(e) => setChunkStrategy(e.target.value as ChunkStrategy)}
            >
              <option value="character">Character</option>
              <option value="recursive">Recursive (natural boundaries)</option>
              <option value="token">Token</option>
            </select>
          </label>

          <label>
            Chunk size
            <input
              type="number"
              min={1}
              value={chunkSize}
              onChange={(e) => setChunkSize(Number(e.target.value))}
            />
          </label>
          <label>
            Overlap
            <input
              type="number"
              min={0}
              value={chunkOverlap}
              onChange={(e) => setChunkOverlap(Number(e.target.value))}
            />
          </label>
          {chunkStrategy === "token" && (
            <label>
              Model (optional)
              <input
                type="text"
                placeholder="e.g. gpt-4o"
                value={chunkModel}
                onChange={(e) => setChunkModel(e.target.value)}
              />
            </label>
          )}
        </section>
      )}

      <div
        className={`dropzone ${isDragging ? "dropzone-active" : ""}`}
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
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={handleFileInputChange}
        />
        {isLoading ? (
          <p>Converting…</p>
        ) : (
          <p>Drop a file here, or click to browse</p>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {result && (
        <section className="result">
          <div className="result-header">
            <h2>{result.title || result.filename}</h2>
            <div className="result-actions">
              {result.chunks && (
                <div className="view-toggle">
                  <button
                    className={viewMode === "markdown" ? "active" : ""}
                    onClick={() => setViewMode("markdown")}
                  >
                    Markdown
                  </button>
                  <button
                    className={viewMode === "chunks" ? "active" : ""}
                    onClick={() => setViewMode("chunks")}
                  >
                    Chunks ({result.chunks.length})
                  </button>
                  <button
                    className={viewMode === "json" ? "active" : ""}
                    onClick={() => setViewMode("json")}
                  >
                    JSON
                  </button>
                </div>
              )}
              <button onClick={handleCopy}>
                Copy {viewMode === "json" && result.chunks ? "JSON" : "Markdown"}
              </button>
              <button onClick={handleDownload}>
                Download {viewMode === "json" && result.chunks ? ".json" : ".md"}
              </button>
            </div>
          </div>

          {(viewMode === "markdown" || !result.chunks) && (
            <pre className="markdown-output">{result.markdown}</pre>
          )}

          {viewMode === "chunks" && result.chunks && (
            <div className="chunks-output">
              {result.chunks.map((chunk, i) => (
                <div className="chunk-card" key={i}>
                  <div className="chunk-meta">
                    {Object.entries(chunk.metadata).map(([k, v]) => (
                      <span key={k}>
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                  <pre>{chunk.text}</pre>
                </div>
              ))}
            </div>
          )}

          {viewMode === "json" && result.chunks && (
            <pre className="markdown-output json-output">
              {JSON.stringify(result.chunks, null, 2)}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
