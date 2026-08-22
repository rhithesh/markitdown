# MarkItDown

[![PyPI](https://img.shields.io/pypi/v/markitdown.svg)](https://pypi.org/project/markitdown/)
![PyPI - Downloads](https://img.shields.io/pypi/dd/markitdown)
[![Built by AutoGen Team](https://img.shields.io/badge/Built%20by-AutoGen%20Team-blue)](https://github.com/microsoft/autogen)

> [!IMPORTANT]
> MarkItDown performs I/O with the privileges of the current process. Like open() or requests.get(), it will access resources that the process itself can access. Sanitize your inputs in untrusted environments, and call the narrowest `convert_*` function needed for your use case (e.g., `convert_stream()`, or `convert_local()`). See the [Security Considerations](#security-considerations) section of the documentation for more information.

MarkItDown is a lightweight Python utility for converting various files to Markdown for use with LLMs and related text analysis pipelines. To this end, it is most comparable to [textract](https://github.com/deanmalmgren/textract), but with a focus on preserving important document structure and content as Markdown (including: headings, lists, tables, links, etc.) While the output is often reasonably presentable and human-friendly, it is meant to be consumed by text analysis tools -- and may not be the best option for high-fidelity document conversions for human consumption.

MarkItDown currently supports the conversion from:

- PDF
- PowerPoint
- Word
- Excel
- Images (EXIF metadata and OCR)
- Audio (EXIF metadata and speech transcription)
- HTML
- Text-based formats (CSV, JSON, XML)
- ZIP files (iterates over contents)
- YouTube URLs
- EPubs
- ... and more!

It can also split converted output into character-based chunks (with page-number metadata) for embedding/RAG pipelines — see [Chunking](#chunking).

## Why Markdown?

Markdown is extremely close to plain text, with minimal markup or formatting, but still
provides a way to represent important document structure. Mainstream LLMs, such as
OpenAI's GPT-4o, natively "_speak_" Markdown, and often incorporate Markdown into their
responses unprompted. This suggests that they have been trained on vast amounts of
Markdown-formatted text, and understand it well. As a side benefit, Markdown conventions
are also highly token-efficient.

## Prerequisites
MarkItDown requires Python 3.10 or higher. It is recommended to use a virtual environment to avoid dependency conflicts.

With the standard Python installation, you can create and activate a virtual environment using the following commands:

```bash
python -m venv .venv
source .venv/bin/activate
```

If using `uv`, you can create a virtual environment with:

```bash
uv venv --python=3.12 .venv
source .venv/bin/activate
# NOTE: Be sure to use 'uv pip install' rather than just 'pip install' to install packages in this virtual environment
```

If you are using Anaconda, you can create a virtual environment with:

```bash
conda create -n markitdown python=3.12
conda activate markitdown
```

## Installation

To install MarkItDown, use pip: `pip install 'markitdown[all]'`. Alternatively, you can install it from the source:

```bash
git clone git@github.com:microsoft/markitdown.git
cd markitdown
pip install -e 'packages/markitdown[all]'
```

## Usage

### Command-Line

```bash
markitdown path-to-file.pdf > document.md
```

Or use `-o` to specify the output file:

```bash
markitdown path-to-file.pdf -o document.md
```

You can also pipe content:

```bash
cat path-to-file.pdf | markitdown
```

### Chunking

For embedding/RAG pipelines, split the converted output into fixed-size character chunks with `--chunk-size` (and optionally `--chunk-overlap`):

```bash
markitdown report.pdf --chunk-size 1000 --chunk-overlap 200
```

Output becomes a single JSON object instead of plain markdown: `{filename: [{text, metadata}, ...]}`. Each chunk's `metadata` includes `filename`, `chunk_index`, `total_chunks`, and `page_no`. `page_no` is populated for PDF (real page numbers) and PPTX (slide numbers); it's `null` for DOCX and other formats that have no native concept of a page. Whitespace is normalized during chunking (runs of tabs/spaces collapse to one space, excess blank lines collapse to one) so extraction artifacts from formats like PDF don't pollute chunk text.

```bash
markitdown report.pdf --chunk-size 1000 --chunk-overlap 200 -o chunks.json
```

writes the same JSON to a file instead of stdout.

By default (`--chunk-strategy character`), text is cut at a strict character count, even mid-word or mid-sentence. Use `--chunk-strategy recursive` instead to prefer natural boundaries -- it tries paragraph breaks first, then falls back to lines, sentences, words, and finally raw characters only for pieces still over `chunk_size`:

```bash
markitdown report.pdf --chunk-size 1000 --chunk-overlap 200 --chunk-strategy recursive
```

Every chunk still strictly respects `chunk_size`; overlap between consecutive chunks is best-effort (there's only overlap where there's room left after fitting whole paragraphs/sentences/words, unlike `character`/`token` strategies where it's exact).

Use `--chunk-strategy token` to count **tokens** instead of characters, using the same tokenizer OpenAI models use ([tiktoken](https://github.com/openai/tiktoken)) — this matches how language models actually consume text, rather than raw character counts:

```bash
markitdown report.pdf --chunk-size 500 --chunk-overlap 50 --chunk-strategy token
```

Token-based chunks additionally include a `token_count` field in `metadata`. This strategy requires the `chunking` optional dependency (see below): `pip install 'markitdown[chunking]'`.

By default, token counting uses `cl100k_base` (GPT-3.5/4's tokenizer). Pass `--chunk-model` to match a specific model's tokenizer instead:

```bash
# OpenAI models resolve via tiktoken automatically, no extra download
markitdown report.pdf --chunk-size 500 --chunk-overlap 50 --chunk-strategy token --chunk-model gpt-4o

# Non-OpenAI models load their real tokenizer from HuggingFace (downloads and
# caches on first use; gated repos need `huggingface-cli login` or HF_TOKEN)
markitdown report.pdf --chunk-size 500 --chunk-overlap 50 --chunk-strategy token --chunk-model meta-llama/Llama-3.1-8B
```

Note: there's no local, offline tokenizer for Claude/Anthropic models — Anthropic's tokenizer is only available via their API. `--chunk-model` with a Claude model name will fail with a clear error rather than silently using the wrong tokenizer.

### Optional Dependencies
MarkItDown has optional dependencies for activating various file formats. Earlier in this document, we installed all optional dependencies with the `[all]` option. However, you can also install them individually for more control. For example:

```bash
pip install 'markitdown[pdf, docx, pptx]'
```

will install only the dependencies for PDF, DOCX, and PPTX files.

At the moment, the following optional dependencies are available:

* `[all]` Installs all optional dependencies
* `[pptx]` Installs dependencies for PowerPoint files
* `[docx]` Installs dependencies for Word files
* `[xlsx]` Installs dependencies for Excel files
* `[xls]` Installs dependencies for older Excel files
* `[pdf]` Installs dependencies for PDF files
* `[outlook]` Installs dependencies for Outlook messages
* `[az-doc-intel]` Installs dependencies for Azure Document Intelligence
* `[az-content-understanding]` Installs dependencies for Azure Content Understanding
* `[audio-transcription]` Installs dependencies for audio transcription of wav and mp3 files
* `[youtube-transcription]` Installs dependencies for fetching YouTube video transcription
* `[chunking]` Installs dependencies for token-based chunking (`--chunk-strategy token`)
* `[semantic-chunking]` Installs dependencies for `SemanticChunker`'s default embedding model (`sentence-transformers`, which pulls in `torch`). Not included in `[all]` due to its size -- install it explicitly, or pass your own `embedding_function` to `SemanticChunker` to skip this dependency entirely.

### Plugins

MarkItDown also supports 3rd-party plugins. Plugins are disabled by default. To list installed plugins:

```bash
markitdown --list-plugins
```

To enable plugins use:

```bash
markitdown --use-plugins path-to-file.pdf
```

To find available plugins, search GitHub for the hashtag `#markitdown-plugin`. To develop a plugin, see `packages/markitdown-sample-plugin`.

#### markitdown-ocr Plugin

The `markitdown-ocr` plugin adds OCR support to PDF, DOCX, PPTX, and XLSX converters, extracting text from embedded images using LLM Vision — the same `llm_client` / `llm_model` pattern that MarkItDown already uses for image descriptions. No new ML libraries or binary dependencies required.

**Installation:**

```bash
pip install markitdown-ocr
pip install openai  # or any OpenAI-compatible client
```

**Usage:**

Pass the same `llm_client` and `llm_model` you would use for image descriptions:

```python
from markitdown import MarkItDown
from openai import OpenAI

md = MarkItDown(
    enable_plugins=True,
    llm_client=OpenAI(),
    llm_model="gpt-4o",
)
result = md.convert("document_with_images.pdf")
print(result.text_content)
```

If no `llm_client` is provided the plugin still loads, but OCR is silently skipped and the standard built-in converter is used instead.

See [`packages/markitdown-ocr/README.md`](packages/markitdown-ocr/README.md) for detailed documentation.

### Azure Content Understanding

[Azure Content Understanding](https://learn.microsoft.com/azure/ai-services/content-understanding/) provides higher-quality conversion with structured field extraction (YAML front matter), multi-modal support (documents, images, audio, video), and configurable analyzers.

Install: `pip install 'markitdown[az-content-understanding]'`

#### When to use Content Understanding

Content Understanding is ideal when you need capabilities beyond what built-in or Document Intelligence converters provide:

- **Audio and video files** — CU is the only option for video, and the higher-quality cloud option for audio. Built-in converters have no video support and only basic audio transcription.
- **Structured field extraction** — [Prebuilt](https://learn.microsoft.com/azure/ai-services/content-understanding/concepts/prebuilt-analyzers) or [custom-built](https://learn.microsoft.com/azure/ai-services/content-understanding/how-to/customize-analyzer-content-understanding-studio?tabs=portal) analyzers extract domain-specific fields (invoice amounts, receipt dates, contract clauses) serialized as YAML front matter. Neither built-in nor Doc Intel integration exposes fields.
- **Higher-quality document extraction** — Cloud-based layout analysis and OCR for scanned PDFs, complex tables, and multi-page documents.
- **Single API for all modalities** — One `cu_endpoint` handles documents, images, audio, and video with automatic analyzer routing.

| Capability | Built-in converters | Azure Document Intelligence | Azure Content Understanding |
|------------|---------------------|-----------------------------|-----------------------------|
| Document conversion | Offline, format-specific extraction | Cloud layout extraction | Cloud multimodal extraction |
| Structured fields | Not available | Not exposed by this integration | YAML front matter from analyzer fields |
| Custom analyzers | Not available | Not configurable in this integration | Supported with `cu_analyzer_id` |
| Audio and video | Basic audio, no video | Not supported | Audio and video analyzers |
| Cost | Local compute only | Billable Azure API calls | Billable Azure API calls |

**CLI:**

```bash
markitdown path-to-file.pdf --use-cu --cu-endpoint "<content_understanding_endpoint>"
```

**Python API:**

```python
from markitdown import MarkItDown

# Zero-config — auto-selects analyzer per file type
md = MarkItDown(cu_endpoint="<content_understanding_endpoint>")
result = md.convert("report.pdf")   # documents → prebuilt-documentSearch
result = md.convert("meeting.mp4")  # video → prebuilt-videoSearch
result = md.convert("call.wav")     # audio → prebuilt-audioSearch
print(result.markdown)
```

**With a custom analyzer** (for domain-specific field extraction):

```python
md = MarkItDown(
    cu_endpoint="<content_understanding_endpoint>",
    cu_analyzer_id="my-invoice-analyzer",
)
result = md.convert("invoice.pdf")
print(result.markdown)
# Output includes YAML front matter with extracted fields:
# ---
# contentType: document
# fields:
#   VendorName: CONTOSO LTD.
#   InvoiceDate: '2019-11-15'
# ---
# <!-- page 1 -->
# ...
```

When `cu_analyzer_id` is set, the converter automatically scopes it to compatible file types based on the analyzer's modality. Incompatible types (e.g., audio files with a document analyzer) auto-route to default prebuilt analyzers.

**Cost note:** Each `convert()` call for a CU-routed format is a billable Azure API call. Use `cu_file_types` to restrict which formats route to CU:

```python
from markitdown.converters import ContentUnderstandingFileType

md = MarkItDown(
    cu_endpoint="<content_understanding_endpoint>",
    cu_file_types=[ContentUnderstandingFileType.PDF],  # only PDFs use CU
)
```

More information about Azure Content Understanding can be found [here](https://learn.microsoft.com/azure/ai-services/content-understanding/).

### Azure Document Intelligence

To use Microsoft Document Intelligence for conversion:

```bash
markitdown path-to-file.pdf -o document.md -d -e "<document_intelligence_endpoint>"
```

More information about how to set up an Azure Document Intelligence Resource can be found [here](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/create-document-intelligence-resource?view=doc-intel-4.0.0)

### Python API

Basic usage in Python:

```python
from markitdown import MarkItDown

md = MarkItDown(enable_plugins=False) # Set to True to enable plugins
result = md.convert("test.xlsx")
print(result.text_content)
```

Document Intelligence conversion in Python:

```python
from markitdown import MarkItDown

md = MarkItDown(docintel_endpoint="<document_intelligence_endpoint>")
result = md.convert("test.pdf")
print(result.text_content)
```

To use Large Language Models for image descriptions (currently only for pptx and image files), provide `llm_client` and `llm_model`:

```python
from markitdown import MarkItDown
from openai import OpenAI

client = OpenAI()
md = MarkItDown(llm_client=client, llm_model="gpt-4o", llm_prompt="optional custom prompt")
result = md.convert("example.jpg")
print(result.text_content)
```

Chunking the converted output for embedding/RAG pipelines:

```python
from markitdown import MarkItDown, CharacterChunker

md = MarkItDown()
result = md.convert("report.pdf")

chunker = CharacterChunker(chunk_size=1000, chunk_overlap=200)
chunks = chunker.chunk(result.markdown, filename="report.pdf")

for c in chunks:
    print(c.text, c.metadata)  # metadata: filename, chunk_index, total_chunks, page_no
```

Or prefer natural boundaries (paragraphs, lines, sentences, words) using `RecursiveCharacterChunker`, falling back to raw characters only when a piece is still too big:

```python
from markitdown import MarkItDown, RecursiveCharacterChunker

md = MarkItDown()
result = md.convert("report.pdf")

chunker = RecursiveCharacterChunker(chunk_size=1000, chunk_overlap=200)
chunks = chunker.chunk(result.markdown, filename="report.pdf")

for c in chunks:
    print(c.text, c.metadata)  # metadata: filename, chunk_index, total_chunks, page_no
```

Or split by LLM token count instead of characters, using `TokenChunker` (requires `pip install 'markitdown[chunking]'`):

```python
from markitdown import MarkItDown, TokenChunker

md = MarkItDown()
result = md.convert("report.pdf")

chunker = TokenChunker(chunk_size=500, chunk_overlap=50, model="gpt-4o")
chunks = chunker.chunk(result.markdown, filename="report.pdf")

for c in chunks:
    print(c.text, c.metadata)  # metadata: filename, chunk_index, total_chunks, page_no, token_count
```

`model` picks the tokenizer: OpenAI model names (e.g. `"gpt-4o"`, `"gpt-4"`) resolve via `tiktoken` automatically; any other model name (e.g. `"meta-llama/Llama-3.1-8B"`) loads that model's real tokenizer from HuggingFace via `transformers.AutoTokenizer` (needs network access on first use, and HuggingFace auth for gated repos). If `model` is omitted, pass `encoding_name` directly instead (default: `"cl100k_base"`).

Or split at actual topic boundaries instead of a fixed size, using `SemanticChunker` (requires `pip install 'markitdown[semantic-chunking]'`, or pass your own `embedding_function`):

```python
from markitdown import MarkItDown, SemanticChunker

md = MarkItDown()
result = md.convert("report.pdf")

chunker = SemanticChunker(target_chunk_size=500)
chunks = chunker.chunk(result.markdown, filename="report.pdf")

for c in chunks:
    print(c.text, c.metadata)  # metadata: filename, chunk_index, total_chunks, page_no
```

`SemanticChunker` implements Chroma's target-size-aware take on Greg Kamradt's semantic chunking ([research.trychroma.com/evaluating-chunking](https://research.trychroma.com/evaluating-chunking)): it embeds each sentence, measures the cosine distance between consecutive sentences to find genuine topic shifts, then binary-searches the breakpoint threshold until the resulting chunks' average size converges on `target_chunk_size` (within `tolerance`, default 10%) — so cuts only ever happen at real topic boundaries, but the output still lands close to a predictable, usable size.

By default it embeds sentences with `sentence-transformers`' `all-MiniLM-L6-v2` model (downloaded and cached locally on first use). To use your own embedding model instead (an OpenAI client, a chromadb `EmbeddingFunction`, etc.), pass `embedding_function` — any callable mapping `List[str]` to a sequence of embedding vectors:

```python
chunker = SemanticChunker(embedding_function=my_embed_fn, target_chunk_size=500)
```

`CharacterChunker`, `RecursiveCharacterChunker`, `TokenChunker`, and `SemanticChunker` all implement the `BaseChunker` interface (`chunk(text, *, filename=None) -> List[Chunk]`), so additional chunking strategies can be added behind the same interface.

### Docker

```sh
docker build -t markitdown:latest .
docker run --rm -i markitdown:latest < ~/your-file.pdf > output.md
```

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

### How to Contribute

You can help by looking at issues or helping review PRs. Any issue or PR is welcome, but we have also marked some as 'open for contribution' and 'open for reviewing' to help facilitate community contributions. These are of course just suggestions and you are welcome to contribute in any way you like.

<div align="center">

|            | All                                                          | Especially Needs Help from Community                                                                                                      |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Issues** | [All Issues](https://github.com/microsoft/markitdown/issues) | [Issues open for contribution](https://github.com/microsoft/markitdown/issues?q=is%3Aissue+is%3Aopen+label%3A%22open+for+contribution%22) |
| **PRs**    | [All PRs](https://github.com/microsoft/markitdown/pulls)     | [PRs open for reviewing](https://github.com/microsoft/markitdown/pulls?q=is%3Apr+is%3Aopen+label%3A%22open+for+reviewing%22)              |

</div>

### Running Tests and Checks

- Navigate to the MarkItDown package:

  ```sh
  cd packages/markitdown
  ```

- Install `hatch` in your environment and run tests:

  ```sh
  pip install hatch  # Other ways of installing hatch: https://hatch.pypa.io/dev/install/
  hatch shell
  hatch test
  ```

  (Alternative) Use the Devcontainer which has all the dependencies installed:

  ```sh
  # Reopen the project in Devcontainer and run:
  hatch test
  ```

- Run pre-commit checks before submitting a PR: `pre-commit run --all-files`

### Security Considerations

MarkItDown performs I/O with the privileges of the current process. Like `open()` or `requests.get()`, it will access resources that the process itself can access.

**Sanitize your inputs:** Do not pass untrusted input directly to MarkItDown. If any part of the input may be controlled by an untrusted user or system, such as in hosted or server-side applications, it must be validated and restricted before calling MarkItDown. Depending on your environment, this may include restricting file paths, limiting URI schemes and network destinations, and blocking access to private, loopback, link-local, or metadata-service addresses.

**Call only the conversion method you need:** Prefer the narrowest conversion API that fits your use case. MarkItDown's `convert()` method is intentionally permissive and can handle local files, remote URIs, and byte streams. If your application only needs to read local files, call `convert_local()` instead. If you need more control over URI fetching, call `requests.get()` yourself and pass the response object to `convert_response()`. For maximum control, open a stream to the input you want converted and call `convert_stream()`.

### Contributing 3rd-party Plugins

You can also contribute by creating and sharing 3rd party plugins. See `packages/markitdown-sample-plugin` for more details.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
