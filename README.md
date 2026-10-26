# mcp-server-3gpp

MCP server for 3GPP and IETF RFC specifications, backed by a prebuilt SQLite corpus.

The current v2 server is built around AI-guided chapter navigation, not hard-coded protocol lookup logic. The intended workflow is:

1. Discover relevant specs with `get_spec_catalog`, `search_etsi_catalog`, or `search_3gpp_docs`.
2. Walk the chapter structure with `get_spec_toc`.
3. Retrieve exact text with `get_section`.
4. Expand locally with `search_related_sections`.
5. Jump across documents with `get_spec_references`.
6. Extract test case structure with `get_test_case_structure` and `list_test_cases`.

Search is a starting point, not the whole product. The model is expected to browse and choose chapters deliberately.

## What ships today

- DB-backed v2 server with 13 MCP tools
- Prebuilt corpus in `data/corpus/3gpp.db`
- 207 specs total: 113 TS, 1 TR, 93 RFC
- 66,109 full sections and 63,376 TOC rows
- 45,162 cross-spec reference edges
- Stdio MCP entrypoint in `src/index.js`
- Optional Streamable HTTP transport in `src/http.js`
- Hybrid search with 4-way RRF (Reciprocal Rank Fusion)
- Optional AnyTXT Searcher integration for Windows
- Optional HyDE (Hypothetical Document Embeddings) query expansion via NVIDIA NIM API

## Search behavior

Search uses a multi-stage retrieval pipeline with up to four parallel retrievers fused by RRF (Reciprocal Rank Fusion, k=60):

```text
Query -> [FTS5/BM25]    (keyword, always active)
      -> [sqlite-vec]    (semantic, when embeddings ready)
      -> [AnyTXT API]    (full-document, when AnyTXT running on Windows)
      -> [HyDE + LLM]    (query expansion, when NVIDIA API key configured)
      -> RRF fusion -> Structure-aware ranking -> Results
```

Key properties:

- Baseline `npm install` gives you the keyword-ready server path: BM25/FTS search, TOC navigation, exact section retrieval, and cross-spec references.
- `search_3gpp_docs` supports quoted phrases, `spec:` filters, `section:` hints, and negation in that baseline path.
- RRF fusion replaces raw score combination with rank-based scoring, eliminating the need for score normalization across retrievers with incompatible distributions. Use `fusion: 'rrf'` (default) or `fusion: 'linear'` to switch.
- The database and runtime can host `sqlite-vec` embeddings via `vec_sections`, but that only makes the corpus vector-capable.
- Semantic or hybrid retrieval should be treated as an optional readiness state. It is active only when the runtime has semantic prerequisites and the smoke path actually returns `mode_actual=hybrid` or `mode_actual=semantic` with semantic evidence in results.
- HyDE expands short/vague queries by generating a hypothetical 3GPP-style answer via NVIDIA LLM, then embedding that answer for vector search. This bridges the vocabulary gap between queries and documents.

## Requirements

- Node.js 20.x, 22.x, and 24.x are the supported, CI-tested runtimes.
- The project uses `better-sqlite3` 12.x so installs can use prebuilt native binaries across the supported Node versions, including Node 24 on Windows.
- If you expand the Node version range later, update the native dependency and CI matrix together.

## Quick start

```bash
git lfs install
git clone https://github.com/Lee-SiHyeon/mcp-server-3gpp.git
cd mcp-server-3gpp
npm install
npm run validate
npm start
```

The bundled database is tracked with Git LFS. A healthy startup looks like:

```text
[3GPP MCP] Database ready: .../data/corpus/3gpp.db
[3GPP MCP] Features - FTS: true, Vector: true
[3GPP MCP] Registered 13 tools (v2 DB mode)
```

`npm run validate` now reports two separate states:

- `Baseline keyword readiness`: the DB-backed 13-tool server is healthy and search/navigation work in keyword mode.
- `Optional semantic readiness`: whether semantic prerequisites are installed and whether the live tool smoke test actually activated semantic/hybrid retrieval.

## Streamable HTTP and Docker

The HTTP transport serves MCP at `/mcp`. A production container requires an
`API_KEY`; send it in an `Authorization: Bearer ...` header. The key is not
accepted as a URL parameter. `/health` checks the process and `/ready` checks
that the configured SQLite corpus is readable and has searchable data.

Fetch the LFS corpus before building. The Docker build fails if the checkout
contains only an LFS pointer, and validates the native SQLite dependency:

```bash
git lfs pull --include='data/corpus/3gpp.db'
docker build -t mcp-server-3gpp:local .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e API_KEY="your-long-random-secret" mcp-server-3gpp:local
```

To build a runtime-only image without bundling or downloading any corpus, use
`docker build --build-arg BUNDLE_CORPUS=false -t mcp-server-3gpp:runtime .`.
At runtime, mount a directory containing `3gpp.db` at `/app/data/corpus`; the
directory must be writable by UID 1000 for SQLite WAL files. `/ready` remains
unavailable until a usable corpus is present. Supply a corpus whose use and
distribution are permitted for the intended deployment.

Connect a Streamable HTTP MCP client to `http://127.0.0.1:3000/mcp` with the
Bearer header. For an external service, put HTTPS in front of the container.
Use `ALLOW_OPEN_HTTP=true` only when intentionally exposing anonymous reads.

Browser requests with an `Origin` header are rejected by default. Set
`CORS_ORIGIN` to a comma-separated list of explicit trusted origins if browser
clients are required. A wildcard is not accepted. Non-browser MCP clients
that omit `Origin` work without this setting. `MAX_SESSIONS` (default 64) and
`SESSION_TTL_MS` (default 30 minutes) bound idle session resources; active event
streams are not expired as idle sessions.

For a 512 MB free hosting instance, set `THREEGPP_DISABLE_SEMANTIC=true`. Search
then uses FTS/BM25 and reports `mode_actual=keyword`, even when the client asks
for semantic or hybrid search. This avoids loading the embedding model; it does
not remove TOC navigation, section lookup, citations, or reference traversal.
The corpus path may be changed using `THREEGPP_DB_PATH`; when specified, a
missing path is treated as unavailable rather than falling back to another DB.
SQLite currently opens the corpus in WAL mode, so its parent directory must be
writable by the container user.

`render.yaml` is an optional free-instance configuration. It generates an API
key in the host account and selects the keyword-only mode. The build context
must contain the actual SQLite corpus; an unresolved LFS pointer is rejected.
Auto-deploy is disabled so updates happen only when deliberately requested.
Free instances can sleep, restart, or stop at account quota limits; a client
may need to initialize a new MCP session after a restart.

Free host allowances and billing safeguards depend on the hosting account.
Check that exceeding bandwidth or build limits stops service rather than
incurring charges before publishing a free-tier endpoint. Git LFS downloads
consume the repository owner's separate LFS allowance.

For a separate VM such as an Always Free instance, `compose.yaml` starts the
MCP container behind Caddy, which obtains HTTPS certificates for a public DNS
name. Fetch the corpus before building, point DNS to the VM, open TCP ports 80
and 443, then provide a strong API key and hostname in a private `.env` file:

```bash
cp .env.example .env
# Set API_KEY and MCP_PUBLIC_HOST in .env; do not commit this file.
docker compose up --build -d
```

Only Caddy publishes ports. The MCP service trusts forwarded addresses from
Caddy; if another proxy or CDN is placed in front of Caddy, configure trusted
proxy addresses before relying on per-client rate limits.

## MCP client configuration

### Claude Desktop

```json
{
  "mcpServers": {
    "3gpp": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-3gpp/src/index.js"]
    }
  }
}
```

### VS Code / GitHub Copilot

```json
{
  "servers": {
    "3gpp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-3gpp/src/index.js"]
    }
  }
}
```

### Optional custom DB path

```json
{
  "env": {
    "THREEGPP_DB_PATH": "/custom/path/to/3gpp.db"
  }
}
```

The server checks these DB locations in order:

1. `THREEGPP_DB_PATH`
2. `data/corpus/3gpp.db`
3. `data/3gpp.db`

## Tool surface

| Tool | Purpose |
| --- | --- |
| `get_spec_catalog` | List indexed specs with title, version, series, description, section count, and page count. |
| `get_spec_toc` | Return the chapter hierarchy for a spec, optionally limited by depth or section prefix. |
| `get_section` | Fetch the exact section text by `sectionId` or `specId + sectionNumber`. |
| `search_3gpp_docs` | Rank candidate sections for a query and return section IDs for follow-up retrieval. |
| `search_related_sections` | Expand from an anchor section through parent, child, sibling, and search-derived neighbors. |
| `get_spec_references` | Traverse incoming and outgoing cross-spec citations. |
| `search_etsi_catalog` | Search cataloged ETSI delivery metadata, including documents not yet downloaded or embedded. |
| `get_etsi_document` | Inspect one ETSI catalog document with versions and optional file URLs. |
| `get_ingest_guide` | Return operational instructions for ETSI download, RFC ingest, or the extraction pipeline. |
| `list_specs` | Compatibility alias with a smaller output shape; prefer `get_spec_catalog`. |
| `get_test_case_structure` | Extract structured test case data (Test Purpose, Conformance Requirements, Test Procedure) from conformance specs. |
| `list_test_cases` | List all test case sections within a spec. |
| `generate_citation` | Format citations for one or more section IDs. |

## Recommended prompting pattern

Use prompts that encourage structure-first navigation:

```text
Find the chapter in TS 24.301 that defines attach reject causes.
Start by locating the spec, then inspect the TOC, then fetch the most relevant section.
```

```text
I need the exact wording for the NAS registration timer behavior in 5G.
Search for likely sections, then read the chapter text and nearby sections.
```

```text
Show which RFCs and 3GPP specs TS 29.500 cites most often.
```

## Corpus statistics

| Metric | Value |
| --- | --- |
| Total specs | 207 |
| TS specs | 113 |
| TR specs | 1 |
| RFC specs | 93 |
| TOC rows | 63,376 |
| Section rows | 66,109 |
| Cross-spec references | 45,162 |
| Ingestion runs recorded | 535 |

## Architecture at a glance

```text
LLM client
  -> MCP transport (stdio or HTTP)
  -> tool registry + validation
  -> tool handlers
  -> SQLite corpus (specs, toc, sections, sections_fts, spec_references, ingestion_runs)
  -> ETSI catalog (etsi_publication_types, etsi_ranges, etsi_documents, etsi_versions, etsi_files)
  -> optional vec_sections table and guide resources
  -> search pipeline:
       keywordSearch.js  (FTS5 + BM25)
       semanticSearch.js  (sqlite-vec cosine)
       anytxtSearch.js    (AnyTXT JSON-RPC API, Windows only)
       hydeExpander.js    (NVIDIA NIM LLM for query expansion)
       hybridRanker.js    (RRF fusion + structure-aware ranking)
```

More detail lives in [docs/architecture.md](docs/architecture.md) and [docs/data-model.md](docs/data-model.md).

## Validation and tests

```bash
npm run validate
npm test
```

`npm run validate` checks the package metadata, resolves the DB path, verifies the core schema and counts, confirms the v2 13-tool surface, runs the navigation smoke path, and reports semantic readiness separately from baseline keyword readiness.

## Optional semantic readiness

Semantic retrieval is not part of the baseline install contract. Treat it as an operator opt-in layer on top of the keyword server.

Current prerequisites:

1. `sqlite-vec` must load successfully at runtime.
2. `vec_sections` must be populated with embeddings for the active corpus.
3. A compatible transformers runtime must be present for local embeddings. The repository now ships with `@huggingface/transformers`, and the runtime still accepts `@xenova/transformers` for compatibility.
4. The live `search_3gpp_docs` smoke path must actually return `mode_actual=hybrid` or `mode_actual=semantic`.

`scripts/generate_embeddings.js` is now the real local corpus-population workflow for `vec_sections`. It can build or rebuild the embedding index, but semantic-active readiness still requires a **fresh full-corpus index**. Partial runs (`--spec` or `--limit`) are useful for smoke tests and controlled backfills, but they intentionally do **not** mark semantic retrieval as globally ready.

## Manual smoke workflows

ETSI catalog smoke:

```bash
npm run catalog:smoke
```

This crawls a tiny ETSI TS range into the catalog tables only. It does not
download PDFs, extract text, or generate embeddings. For broader cataloging,
use `npm run catalog:crawl -- --all-publication-types --depth versions` and add
limits such as `--max-ranges`, `--max-docs`, `--max-versions`, or
`--max-requests` for controlled backfills.

Catalog crawler safety controls:

```bash
python3 scripts/crawl_etsi_catalog.py --publication-types etsi_ts etsi_tr --depth documents --plan-only
python3 scripts/crawl_etsi_catalog.py --publication-types etsi_ts etsi_tr --depth documents --max-ranges 10
python3 scripts/crawl_etsi_catalog.py --publication-types etsi_ts etsi_tr --depth documents --resume
python3 scripts/select_etsi_ingest.py --policy priority --format download-list
```

The crawler records progress in `catalog_crawl_runs` and
`catalog_crawl_progress`. Long catalog writes remain CLI-only; MCP catalog tools
are read-only. Download, extraction, and embedding status lives separately from
document identity in `etsi_document_status`. `select_etsi_ingest.py` marks
priority 3GPP-mapped ETSI documents for later download/extract/embed work and
can emit a tab-separated download plan without downloading any PDFs.

Degraded-path smoke:

```bash
npm install
npm run validate
```

Expected result:

- `Baseline keyword readiness: true`
- `Optional semantic prerequisites met: false` or `Semantic-active tool smoke: false`
- `Search mode actual: keyword`

Semantic-active smoke:

1. Run `npm install`.
2. Ensure `sqlite-vec` loads and `vec_sections` is populated with a fresh **full-corpus** embedding index that matches the active 384-dim model/prefix contract. Example:

```bash
node scripts/generate_embeddings.js --rebuild
```

3. Run `npm run validate`.

Expected result:

- `Optional semantic prerequisites met: true`
- `Semantic-active tool smoke: true`
- `Semantic smoke mode actual: hybrid` or `semantic`

## Optional AnyTXT integration (Windows)

AnyTXT Searcher provides an additional search signal and document parsing for formats beyond PDF. When running, its JSON-RPC API at `localhost:9920` is auto-detected.

Prerequisites:

1. Install [AnyTXT Searcher](https://anytxt.net/) on Windows.
2. Enable the HTTP API: menu Help -> API.
3. Sync the `raw/` directory into AnyTXT's index (Tools -> Index Manager).

When available, AnyTXT adds a third retriever to the RRF fusion, searching raw file content including DOCX, XLSX, and scanned PDF (OCR). When unavailable, the pipeline degrades to 2-way RRF (keyword + semantic).

CLI extraction tool:

```bash
node scripts/extract_anytxt.js --check                # verify API availability
node scripts/extract_anytxt.js --sync raw/            # sync raw dir to AnyTXT index
node scripts/extract_anytxt.js raw/ts_38_523_1.pdf    # extract text from a file
node scripts/extract_anytxt.js --batch raw/           # batch extract all supported files
```

## Optional HyDE query expansion

HyDE (Hypothetical Document Embeddings) improves recall for short or vague queries by generating a hypothetical 3GPP-style answer via LLM, then using that answer's embedding for vector search. This bridges the vocabulary gap between queries and technical documents.

Configure via environment variable or programmatic API:

```bash
NVIDIA_API_KEY=nvapi-... npm start
```

```js
import { configureHyde } from './src/search/hybridRanker.js';
configureHyde({ apiKey: 'nvapi-...' });
```

Defaults to `nvidia/llama-3.1-nemotron-nano-8b-v1` on the NVIDIA NIM endpoint. Any OpenAI-compatible chat completion URL can be used via the `apiUrl` option.

## Project structure

```text
mcp-server-3gpp/
├── src/
│   ├── index.js
│   ├── http.js
│   ├── db/
│   ├── search/
│   │   ├── hybridRanker.js      (RRF fusion + structure-aware ranking)
│   │   ├── keywordSearch.js     (FTS5 + BM25)
│   │   ├── semanticSearch.js    (sqlite-vec)
│   │   ├── anytxtSearch.js      (AnyTXT JSON-RPC retriever)
│   │   ├── hydeExpander.js      (HyDE query expansion via NVIDIA LLM)
│   │   └── queryParser.js
│   ├── anytxt/
│   │   ├── client.js            (JSON-RPC 2.0 client)
│   │   └── parser.js            (document text extraction)
│   ├── tools/
│   └── ingest/
├── docs/
├── data/
│   └── corpus/
│       └── 3gpp.db
├── test/
├── validate.js
└── package.json
```

## Notes

- The documented operating model is the DB-backed v2 server.
- There is still a legacy fallback path in `src/index.js` if no SQLite DB is found, but that is a bootstrap escape hatch, not the primary interface this repository documents.
- `get_section` and `get_spec_toc` are the core deterministic retrieval tools. Search should feed them, not replace them.
