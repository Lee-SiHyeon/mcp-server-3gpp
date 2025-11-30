# mcp-server-3gpp

🔍 **MCP Server for 3GPP Specification Document Search**

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI assistants to search and retrieve information from 3GPP specification documents.

## Features

- 📚 **Search 3GPP Documents**: Full-text search across 3GPP specifications
- 📋 **EMM/5GMM Cause Lookup**: Quick reference for LTE and 5G NAS cause values
- 🎯 **Pre-built Data Included**: Ready to use immediately after installation
- 🔄 **MCP SDK v1.0.0 Compatible**: Full support for structured responses
- ✅ **Comprehensive Testing**: 13 test scenarios with validation tools

### ✅ Included Specifications (Pre-processed)

- **TS 24.008** - 2G/3G NAS (MM/GMM/SM/CC)
- **TS 24.301** - LTE NAS (EMM/ESM)
- **TS 24.501** - 5G NAS (5GMM/5GSM)
- **TS 36.300** - E-UTRA Overall Description

### 📥 Additional Specifications (User can add)

The MCP server architecture supports expanding to more specifications. Users can add:

**PCT (Protocol Conformance Test)**
- TS 51.010-1 (2G), TS 34.123-1 (3G), TS 36.523-1 (4G), TS 38.523-1 (5G)

**Protocol**
- TS 31.121 (USIM), TS 31.124 (USAT)

**IMS**
- TS 34.229-1 (4G IMS), TS 34.229-5 (5G IMS)

**Architecture**
- TS 38.300 (NR Overall), TR 37.901 (Data Throughput)

**RF (if needed)**
- TS 36.521, TS 38.521 series, etc.

To add specifications: Download PDFs → Run `npm run setup`

## Available Tools

| Tool | Description |
|------|-------------|
| `search_3gpp_docs` | Search 3GPP documents by keywords |
| `get_emm_cause` | Get EMM cause (LTE) or 5GMM cause (5G) details |
| `list_specs` | List available specifications |

## Testing & Validation

This package includes comprehensive testing tools:

```bash
# Run all SpecKit user story tests (13 scenarios)
npm test

# Validate data structure and MCP server
npm run validate
```

**Test Coverage**:
- ✅ 13 acceptance scenarios from SpecKit specs
- ✅ All 3 MCP tools (search, get_emm_cause, list_specs)
- ✅ Data structure validation (22,408 chunks)
- ✅ EMM/5GMM cause lookup verification

## Installation

### Prerequisites

- Node.js >= 18.0.0
- **Git LFS** (for downloading pre-built data)

### Quick Start (Recommended)

```bash
# Install Git LFS (if not already installed)
git lfs install

# Clone and install
git clone https://github.com/Lee-SiHyeon/mcp-server-3gpp.git
cd mcp-server-3gpp
npm install

# If chunks.json is a pointer file, pull LFS data
git lfs pull

# ✅ Ready to use! Pre-built data with 17 specs included.
npm start
```

> **Note**: The pre-built `chunks.json` (107MB) is stored with Git LFS. If you don't have Git LFS installed, you can still use the MCP server for EMM/5GMM cause lookup, or generate data yourself using the scripts.

### Included Specs
The package includes **pre-processed chunks** for 17 specifications:

**NAS Layer (4 specs)**
- TS 24.008 (2G/3G NAS)
- TS 24.301 (LTE NAS)  
- TS 24.501 (5G NAS)
- TS 36.300 (E-UTRA Architecture)

**RRC - Radio Resource Control (3 specs) 🆕**
- TS 25.331 (3G UMTS RRC - SIB details)
- TS 36.331 (4G LTE RRC - SIB details)
- TS 38.331 (5G NR RRC - SIB details)

**PCT - Protocol Conformance Test (4 specs)**
- TS 51.010-1 (2G Protocol)
- TS 34.123-1 (3G Protocol)
- TS 36.523-1 (4G Protocol)
- TS 38.523-1 (5G Protocol)

**USIM/USAT (2 specs)**
- TS 31.121 (USIM)
- TS 31.124 (USAT)

**IMS (2 specs)**
- TS 34.229-1 (4G IMS)
- TS 34.229-5 (5G IMS)

**Architecture (2 specs)**
- TS 38.300 (5G NR)
- TR 37.901 (Data Throughput)

**Total: 22,408 pre-built chunks, ~107MB**

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
