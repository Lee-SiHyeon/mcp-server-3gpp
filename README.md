# mcp-server-3gpp

🔍 **MCP Server for 3GPP Specification Document Search**

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI assistants to search, navigate, and retrieve content from 3GPP and IETF RFC specification documents.

## Features

- 📚 **207 specifications** indexed — 114 3GPP/ETSI + 93 IETF RFC (66,109 sections)
- 🔍 **Hybrid search**: BM25/FTS5 keyword search + optional sqlite-vec semantic search
- 🗂️ **Hierarchical TOC navigation** — browse spec structure before fetching sections
- 🔗 **Cross-spec reference graph** — 45,162 citation relationships extracted from corpus
- 🧠 **LLM-first design** — 8 generic tools; LLM navigates freely, no hard-coded lookups
- 🔄 **MCP SDK compatible**: stdio transport, JSON-RPC 2.0

## Quick Install

```bash
# 1. Clone (Git LFS required for the pre-built database)
git lfs install
git clone https://github.com/Lee-SiHyeon/mcp-server-3gpp.git
cd mcp-server-3gpp

# 2. Install Node dependencies
npm install

# 3. Verify the database is present (~416 MB, tracked by Git LFS)
ls -lh data/corpus/3gpp.db

# 4. Test the server
npm start   # Should print: [3GPP MCP] Registered 8 tools (v2 DB mode)
```

> **No Git LFS?**  
> Install it first: `apt install git-lfs` / `brew install git-lfs` / [git-lfs.com](https://git-lfs.github.com)  
> Then: `git lfs pull` inside the cloned repo.

---

## MCP Client Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or  
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Add to `.vscode/mcp.json` in your workspace:

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

### GitHub Copilot CLI (`~/.copilot/mcp.json`)

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

### Custom DB path (optional)

```json
"env": { "THREEGPP_DB_PATH": "/custom/path/to/3gpp.db" }
```

---

## Available Tools (8)

| Tool | Description |
|------|-------------|
| `get_spec_catalog` | List all 207 specs with metadata (title, version, section count). Use first to discover spec IDs. |
| `get_spec_toc` | Get section hierarchy (TOC) for a spec. Returns section numbers, titles, page numbers. |
| `get_section` | Fetch full text of a section by `sectionId` (e.g. `ts_24_301:5.5.1.2.4`) or spec+number. |
| `search_3gpp_docs` | Keyword/semantic hybrid search across all sections. Supports quoted phrases and spec filter. |
| `search_related_sections` | Given an anchor section, find parent/child/sibling/similar sections. |
| `get_spec_references` | Cross-spec citation graph: which specs does this spec cite? Who cites it? |
| `get_ingest_guide` | Returns step-by-step guide for expanding the corpus (ETSI download, RFC ingest, AutoRAG pipeline). |
| `list_specs` | Simple spec list with section counts (legacy-compatible alias for `get_spec_catalog`). |

### Example Queries (for LLM)

```
# Find the 5G attach procedure
search_3gpp_docs("registration procedure NR", spec="ts_24_501")

# Browse TS 24.301 structure
get_spec_toc("ts_24_301", maxDepth=3)

# Read a specific section
get_section("ts_24_301:5.5.1.2.4")

# What does TS 24.301 reference?
get_spec_references("ts_24_301", direction="outgoing", inCorpusOnly=true)

# Navigate from a section outward
search_related_sections("ts_24_301:5.5.1", sameSpecOnly=false)
```

---

## Corpus Statistics

| Metric | Value |
|--------|-------|
| 3GPP/ETSI specs | 114 |
| IETF RFC specs | 93 |
| **Total specs** | **207** |
| **Total sections** | **66,109** |
| Cross-spec references | 45,162 |
| DB size | ~416 MB (Git LFS) |
| Full-text search | FTS5 / BM25 |
| Semantic search | Optional (sqlite-vec, requires `generate_embeddings.js`) |

### Included Spec Families

**3GPP/ETSI (114 specs)**
- NAS: TS 24.008, 24.301, 24.501, 24.229 (IMS SIP)
- RRC: TS 25.331, 36.331, 38.331
- Conformance: TS 34.123-1, 36.523-1, 38.523-1, 51.010-1
- 5G Core SBA: TS 29.500–29.599 (62 specs)
- Security: TS 33.102, 33.401, 33.501
- USIM: TS 31.102, 31.121, 31.124
- Architecture: TS 23.xxx, 38.xxx series

**IETF RFC (93 specs)**
- SIP/VoIP: RFC 3261, 3262–3265, 3311, 3428
- Diameter: RFC 3588, 4005, 6733
- TLS/DTLS: RFC 5246, 8446, 9147
- QUIC: RFC 9000–9002
- HTTP: RFC 7540, 9110–9114
- OAuth/JWT: RFC 6749, 6750, 7519, 8693, 9068
- DNS: RFC 1034, 1035, 4033–4035
- WebRTC, SCTP, RTP, SDP, STUN, TURN, IPsec, IKEv2, BGP, MPLS…

---

## Architecture

```
                  ┌─────────────────────────────────┐
                  │        MCP Client (LLM)          │
                  └────────────┬────────────────────┘
                               │ JSON-RPC 2.0 (stdio)
                  ┌────────────▼────────────────────┐
                  │      src/index.js (MCP Server)   │
                  │   8 tools registered             │
                  └────────────┬────────────────────┘
                               │
                  ┌────────────▼────────────────────┐
                  │     data/corpus/3gpp.db          │
                  │  SQLite + FTS5 + spec_references │
                  │  207 specs / 66,109 sections     │
                  └─────────────────────────────────┘
```

### DB Schema (key tables)
- `specs` — one row per specification (id, title, version, series)
- `sections` — full section text (id, spec_id, section_number, content, depth)
- `toc` — lightweight navigation index (section_number, title, brief, page)
- `sections_fts` — FTS5 virtual table, BM25 keyword search
- `spec_references` — cross-spec citation graph (45,162 rows)
- `vec_sections` — sqlite-vec float[384] embeddings (optional, requires generation)

---

## Rebuilding the Corpus

The pre-built `data/corpus/3gpp.db` is included via Git LFS. Only rebuild if you want to add new specs.

### Prerequisites

```bash
# Python packages (for PDF extraction only)
pip install -r requirements.txt   # PyMuPDF + requests
```

### Add new 3GPP/ETSI specs

```bash
npm run corpus:download   # Download latest PDFs from ETSI
npm run corpus:extract    # Extract sections → JSONL
npm run corpus:build      # Build/update SQLite DB
# Or all at once:
npm run corpus:full
```

### Add RFC documents

```bash
npm run rfc:all           # Download + extract + load all priority RFCs
# Or step by step:
npm run rfc:download
npm run rfc:extract
npm run rfc:load
```

### Rebuild cross-spec reference graph

```bash
node scripts/extract_cross_refs.js --verbose
```

### Enable semantic search (optional)

```bash
node scripts/generate_embeddings.js   # Generates float[384] embeddings into vec_sections
```

---

## Testing

```bash
npm test          # Full test suite (node:test)
npm run validate  # Validate DB and MCP server
```

---

## Project Structure

```
mcp-server-3gpp/
├── src/
│   ├── index.js                  # MCP server entry point
│   ├── tools/                    # 8 tool handlers
│   │   ├── getSpecCatalog.js
│   │   ├── getSpecToc.js
│   │   ├── getSection.js
│   │   ├── search3gppDocs.js
│   │   ├── searchRelatedSections.js
│   │   ├── getSpecReferences.js  # Cross-spec citation graph
│   │   ├── getIngestGuide.js
│   │   └── listSpecs.js
│   ├── search/
│   │   └── hybridRanker.js       # BM25 + vector fusion (α=0.4)
│   └── db/
│       ├── connection.js         # better-sqlite3 singleton
│       └── schema.js             # Schema init + sqlite-vec probe
├── scripts/
│   ├── extract_cross_refs.js     # Cross-reference extraction
│   ├── download_etsi_specs.py    # ETSI PDF downloader
│   ├── download_rfc.py           # IETF RFC downloader
│   ├── extract_pdf_structure.py  # PyMuPDF section extractor
│   ├── extract_rfc_structure.py  # RFC text parser
│   ├── build_section_spans.py    # Section boundary detector
│   └── build_corpus.js           # SQLite builder
├── data/
│   └── corpus/
│       └── 3gpp.db               # Pre-built corpus (~416 MB, Git LFS)
├── db/
│   └── schema.sql                # SQLite DDL
├── test/                         # node:test suite
├── requirements.txt              # Python deps (PyMuPDF, requests)
└── package.json
```

---

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

Not affiliated with 3GPP. Specification documents are copyrighted by ETSI and 3GPP partners. Users are responsible for complying with applicable terms when downloading specification PDFs.
