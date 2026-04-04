# mcp-server-3gpp

🔍 **MCP Server for 3GPP Specification Document Search**

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI assistants to search and retrieve information from 3GPP specification documents.

## Features

- 📚 **Full-text search** across 207 specifications — 3GPP/ETSI + IETF RFC (93,279 indexed sections)
- 🔍 **Hybrid search engine**: BM25/FTS5 keyword + optional semantic vector search
- 📋 **EMM/5GMM Cause Lookup**: Quick reference for LTE and 5G NAS cause values
- 🗂️ **Hierarchical TOC navigation**: Browse spec structure before fetching sections
- 🔄 **MCP SDK v1.0.0 Compatible**: Full support for structured responses
- ✅ **Comprehensive Test Suite**: `node:test` unit + integration tests

## v2.0 Architecture

SQLite + FTS5 + hybrid search. **207 specs, 93,279 sections** indexed (114 3GPP/ETSI + 93 IETF RFC).

The v2 corpus is built from extracted PDF text using a Python/Node pipeline:

```
PDFs → extract_all.py → sections JSONL → build_corpus.js → 3gpp.db (SQLite)
                                                               └─ FTS5 index
```

See [docs/architecture.md](docs/architecture.md) for a full component breakdown.

## Corpus Stats

| Metric | Value |
|--------|-------|
| 3GPP/ETSI specs indexed | 114 |
| IETF RFC specs indexed | 93 |
| **Total specs** | **207** |
| **Total sections** | **93,279** |
| Full-text search | FTS5 (BM25 ranking) |
| Semantic search | Optional (requires sqlite-vec) |

## Available Tools

| Tool | Description | Example Input |
|------|-------------|---------------|
| `get_spec_catalog` | Browse all 207 indexed specs with metadata | `{"filter": "24_301"}` |
| `get_spec_toc` | Get section hierarchy of a spec | `{"specId": "ts_24_301", "maxDepth": 3}` |
| `get_section` | Fetch full content of a section | `{"sectionId": "ts_24_301:5.5.1.2.5"}` |
| `search_3gpp_docs` | Hybrid keyword/semantic search | `{"query": "authentication", "spec": "ts_24_301"}` |
| `search_related_sections` | Find conceptually related sections | `{"sectionId": "ts_24_301:5.5"}` |
| `get_emm_cause` | Lookup EMM/5GMM cause codes | `{"cause": 17}` |
| `list_specs` | List available specs (simple) | `{}` |

## Testing

```bash
# Run the full test suite (node:test, no external frameworks)
npm test

# Run legacy SpecKit user story tests
npm run test:legacy

# Validate data structure and MCP server
npm run validate
```

**Test Coverage**:
- ✅ `test/search.test.js` — hybridSearch keyword/filter/edge-case tests
- ✅ `test/ingest.test.js` — sectionNormalizer pure-function unit tests
- ✅ `test/tools.test.js` — MCP tool handler tests + graceful degradation scenarios

## Installation

### Prerequisites

- Node.js >= 18.0.0
- Python 3.8+ with `pdfplumber` (for corpus building)

### Quick Start (with pre-built DB)

```bash
git clone https://github.com/Lee-SiHyeon/mcp-server-3gpp.git
cd mcp-server-3gpp
npm install

# Start the MCP server (requires data/corpus/3gpp.db)
npm start
```

### Building the Corpus

If you don't have `data/corpus/3gpp.db`, build it from scratch:

```bash
# Full pipeline: download PDFs → extract sections → build SQLite DB
npm run corpus:full

# Or run each step individually:
npm run corpus:download   # python3 scripts/download_etsi_specs.py --latest-only
npm run corpus:extract    # python3 scripts/extract_all.py
npm run corpus:build      # node scripts/build_corpus.js

# Rebuild an existing DB (re-indexes everything)
npm run corpus:rebuild
```

### Adding RFC Documents

```bash
# Full RFC pipeline (download + extract + load all 89 priority RFCs)
npm run rfc:all

# Or step by step:
npm run rfc:download   # python3 scripts/download_rfc.py --all
npm run rfc:extract    # python3 scripts/extract_rfc_structure.py --all
npm run rfc:load       # node src/ingest/loadRfcSections.js --all
```

### Included Specs
The corpus includes **207 specifications** across three document families:

**3GPP/ETSI (114 specs)** — NAS, RRC, conformance, USIM, IMS, SBI, security, radio
- NAS: TS 24.008, 24.301, 24.501, 24.229 (IMS SIP)
- RRC: TS 25.331, 36.331, 38.331
- Conformance: TS 34.123-1, 36.523-1, 38.523-1, 51.010-1
- 5G SBA: 62 specs (TS 29.500–29.599)
- Security: TS 33.102, 33.401, 33.501
- USIM: TS 31.102, 31.121, 31.124
- NTN: TS 38.863
- ...and more (36.xxx, 38.xxx, 23.xxx, 29.xxx series)

**IETF RFC (86 specs)** — core internet protocols
- SIP/VoIP: RFC 3261, 3262–3265, 3311, 3428, 3515
- Diameter: RFC 3588, 4005, 4006, 4072, 5779, 6733
- TLS/DTLS: RFC 5246, 8446, 9147
- QUIC: RFC 9000, 9001, 9002
- HTTP: RFC 7540, 9110, 9112, 9113, 9114
- OAuth/JWT: RFC 6749, 6750, 7519, 8693, 9068
- SSH: RFC 4251–4254
- DNS/DNSSEC: RFC 1034, 1035, 4033–4035, 7858, 8484
- WebRTC: RFC 8825–8827, 8834, 8835
- SCTP, RTP, SDP, STUN, TURN, XMPP, NETCONF, YANG, BGP, OSPF, MPLS, IPsec, IKEv2...

**Total: 207 specs, 93,279 sections**

### Optional: Update Data

If you want to regenerate data with the latest 3GPP specifications:

```bash
# Option 1: Automatic (downloads and processes PDFs)
npm run setup

# Option 2: Manual
# Step 1: Download PDFs
npm run download-pdfs
# Step 2: Extract and chunk
npm run prepare-data
```

## Data Preparation

### ✅ Pre-built Data Included (Git LFS)

This package includes **pre-processed 3GPP specification data** (chunks.json) with **17 specifications** and **22,408 chunks** (~107MB).

**Important**: The data file is stored using **Git LFS** (Large File Storage).

#### If you have Git LFS installed:
```bash
git lfs pull  # Download the actual data file
```

#### If you don't have Git LFS:
```bash
# Option 1: Install Git LFS (recommended)
# Windows: Download from https://git-lfs.github.com/
# Mac: brew install git-lfs
# Linux: sudo apt-get install git-lfs

git lfs install
git lfs pull

# Option 2: Manual download
# Download chunks.json from GitHub releases or generate it yourself (see below)
```

> **Without Git LFS**: The MCP server will still work for EMM/5GMM cause lookup. Full document search requires the data file.

### 📥 Add More Specifications (Optional)

Want to add more specifications? Follow these steps:

#### Prerequisites

```bash
# Install Python dependencies (required for PDF processing)
pip install pymupdf
```

#### Option 1: Automatic Download

Download additional specifications automatically:

```bash
# Download PCT specs (Protocol, USIM, USAT, IMS, Architecture)
python scripts/download_pct_specs.py

# Download RRC specs (3G/4G/5G RRC with SIB details) 🆕
python scripts/download_rrc_specs.py
```

**PCT specs** include:
- **Protocol**: TS 51.010-1 (2G), TS 34.123-1 (3G), TS 36.523-1 (4G), TS 38.523-1 (5G)
- **USIM/USAT**: TS 31.121, TS 31.124
- **IMS**: TS 34.229-1, TS 34.229-5
- **Architecture**: TS 38.300, TR 37.901

**RRC specs** include (for SIB details):
- **TS 25.331** (3G UMTS RRC)
- **TS 36.331** (4G LTE RRC)  
- **TS 38.331** (5G NR RRC)

#### Option 2: Manual Download

Download specifications manually from:
- [3GPP Official Site](https://www.3gpp.org/specifications)
- [ETSI Standards](https://www.etsi.org/standards)

Place PDFs in the `raw/` folder.

#### Process PDFs and Update chunks.json

After downloading PDFs:

```bash
# Step 1: Extract text from all PDFs in raw/ folder
python scripts/extract_pdf.py

# Step 2: Create chunks from extracted text
python scripts/create_chunks_simple.py

# Step 3: Copy to data folder
# Windows:
copy "extracted\chunks.json" "data\chunks.json"
# Linux/Mac:
cp extracted/chunks.json data/chunks.json
```

### Advanced: Customize Scripts

All scripts are fully editable:

- `scripts/download_pct_specs.py` - Modify to download different specs
- `scripts/extract_pdf.py` - Adjust text extraction settings
- `scripts/create_chunks_simple.py` - Change chunk size/overlap

Example: Edit `download_pct_specs.py` to add new specifications:

```python
SPECS = [
    {
        'name': 'ts_your_spec',
        'series': '12300_12399',  # ETSI series folder
        'spec_num': '123001',     # Spec number
        'version': '18.00.00_60', # Target version
        'description': 'Your Spec Description'
    },
    # Add more specs...
]
```

## Configuration

### VS Code / GitHub Copilot

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "3gpp-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-server-3gpp/src/index.js"]
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "3gpp-docs": {
      "command": "node",
      "args": ["/path/to/mcp-server-3gpp/src/index.js"]
    }
  }
}
```

### Custom Data Path

Set the `CHUNKS_FILE_PATH` environment variable to use a custom chunks file location:

```json
{
  "servers": {
    "3gpp-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-server-3gpp/src/index.js"],
      "env": {
        "CHUNKS_FILE_PATH": "/path/to/your/chunks.json"
      }
    }
  }
}
```

## Usage Examples

Once configured, you can ask your AI assistant:

- *"What is EMM cause #3?"*
- *"Search for attach procedure in 3GPP docs"*
- *"Explain 5GMM cause #7"*
- *"Find information about tracking area update"*
- *"List all available 3GPP specifications"*
- *"Search for SIB information in RRC specs"*

### Response Format

All tools return **structured responses** compatible with MCP SDK v1.0.0:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Human-readable response"
    }
  ],
  "structuredContent": {
    "results": [
      {
        "source": "ts_124301_v18.9.0_LTE_NAS",
        "content": "Detailed specification text..."
      }
    ]
  }
}
```

This allows AI clients to:
- Display formatted text to users
- Process structured data programmatically
- Integrate with automation workflows

## EMM/5GMM Cause Quick Reference

### Common EMM Causes (LTE - TS 24.301)

| Cause | Name |
|-------|------|
| #3 | Illegal UE |
| #6 | Illegal ME |
| #7 | EPS services not allowed |
| #11 | PLMN not allowed |
| #12 | Tracking Area not allowed |
| #15 | No Suitable Cells In TA |
| #22 | Congestion |

### Common 5GMM Causes (5G - TS 24.501)

| Cause | Name |
|-------|------|
| #3 | Illegal UE |
| #6 | Illegal ME |
| #7 | 5GS services not allowed |
| #11 | PLMN not allowed |
| #62 | No network slices available |
| #65 | Maximum PDU sessions reached |

## Project Structure

```
mcp-server-3gpp/
├── src/
│   └── index.js                    # MCP server implementation
├── scripts/
│   ├── extract_pdf.py              # PDF text extraction (editable)
│   ├── create_chunks_simple.py     # Text chunking (editable)
│   ├── download_pct_specs.py       # Auto-download PCT specs (editable)
│   ├── download_rrc_specs.py       # Auto-download RRC specs (editable) 🆕
│   ├── download-pdfs.js            # Download NAS specs
│   └── postinstall.js              # Post-install setup
├── data/
│   └── chunks.json                 # Pre-built chunks (22,408 chunks, 107MB)
├── test_speckit_userstories.js     # Comprehensive test suite 🆕
├── validate.js                     # Data & server validation 🆕
├── raw/                            # Place PDFs here (optional)
├── extracted/                      # Extracted text files (generated)
├── package.json
└── README.md
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) file.

## Disclaimer

This project is not affiliated with 3GPP. 3GPP specifications are copyrighted by ETSI and 3GPP partners. Users are responsible for complying with 3GPP's terms of use when downloading and using specification documents.

## Developer Documentation

### SpecKit (Spec-Driven Development)

This project uses [SpecKit](https://github.com/github/spec-kit) for maintaining development context and collaboration.

#### What is SpecKit?

SpecKit is a **Spec-Driven Development** framework that helps developers and AI agents maintain shared context through structured specifications.

**Key Principle**: Specifications come first, code follows.

#### SpecKit Workflow

```
Constitution → Specify → Plan → Tasks → Implement
```

1. **Constitution** (`.specify/constitution.md`): Project principles, technical stack, historical decisions
2. **Specs** (`.specify/specs/`): Feature specifications with user stories and acceptance criteria
3. **Plans** (`.specify/plans/`): Technical implementation plans and architecture
4. **Tasks** (`.specify/tasks/`): Granular task breakdowns with dependencies

#### Using SpecKit

If you have Claude Desktop or VS Code with the SpecKit extension:

**Available Slash Commands**:
- `/speckit-constitution` - View/update project constitution
- `/speckit-specify` - Create feature specifications
- `/speckit-plan` - Create implementation plans
- `/speckit-tasks` - Break down tasks
- `/speckit-implement` - Execute implementation
- `/speckit-clarify` - Clarify ambiguous specifications
- `/speckit-analyze` - Analyze consistency across specs
- `/speckit-checklist` - Quality checklist
- `/speckit-taskstoissues` - Convert tasks to GitHub Issues

**Manual Access**:
All SpecKit files are in `.specify/` directory and can be read/edited directly:
```
.specify/
├── constitution.md          # Project overview
├── specs/
│   └── 001-3gpp-document-search.md
├── plans/
│   └── 001-implementation-plan.md
├── tasks/
│   └── 001-tasks.md
└── templates/               # Templates for new features
```

#### Why SpecKit for this Project?

- **Context Sharing**: NAD team and future developers have complete project history
- **AI Collaboration**: AI agents understand design decisions and constraints
- **Onboarding**: New contributors can read specs instead of reverse-engineering code
- **Documentation**: Living documentation that evolves with code

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [3GPP Specifications](https://www.3gpp.org/specifications)
- [SpecKit - Spec-Driven Development](https://github.com/github/spec-kit)
