# mcp-server-3gpp

🔍 **MCP Server for 3GPP Specification Document Search**

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI assistants to search and retrieve information from 3GPP specification documents.

## Features

- 📚 **Search 3GPP Documents**: Full-text search across 3GPP specifications
- 📋 **EMM/5GMM Cause Lookup**: Quick reference for LTE and 5G NAS cause values
- � **Pre-built Data Included**: Ready to use immediately after installation

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

## Installation

### Prerequisites

- Node.js >= 18.0.0

### Quick Start (Recommended)

```bash
# Clone and install
git clone https://github.com/Lee-SiHyeon/mcp-server-3gpp.git
cd mcp-server-3gpp
npm install

# ✅ Ready to use! Pre-built data for NAS specs included.
npm start
```

### Included Specs
The package includes **pre-processed chunks** for core NAS specifications:
- TS 24.008 (2G/3G NAS)
- TS 24.301 (LTE NAS)  
- TS 24.501 (5G NAS)
- TS 36.300 (E-UTRA Architecture)

**Total: 3,089 pre-built chunks, ~10MB**

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

### ✅ Pre-built Data Included

This package includes **pre-processed 3GPP specification data** (chunks.json) so you can use it immediately after installation.

### 📥 Update Data (Optional)

To regenerate data with the latest specifications:

#### Automatic Setup (Recommended)

```bash
npm run setup
```

This will:
1. Download 3GPP PDFs from official sources
2. Extract text from PDFs (requires Python with PyMuPDF)
3. Create searchable chunks

#### Manual Setup

#### Manual Setup

**Step 1: Download PDFs**

Download specifications from [3GPP Specifications](https://www.3gpp.org/specifications):

**NAS Layer**
- TS 24.008 (2G/3G NAS), TS 24.301 (LTE NAS), TS 24.501 (5G NAS)

**RF (Radio Frequency)**
- TS 51.010-1 (2G), TS 34.121 (3G), TS 36.521 (4G), TS 38.521 series (5G)

**RCT (Radio Conformance Test)**
- TS 34.123 (3G), TS 36.523 (4G), TS 38.523 (5G)

**Protocol**
- TS 31.121 (USIM), TS 31.124 (USAT)

**IMS**
- TS 34.229-1 (4G), TS 34.229-5 (5G)

**RSE**
- TS 36.124 (4G), TS 38.124 (5G)

**Architecture**
- TS 36.300 (E-UTRA), TS 38.300 (NR)

Or use automatic download:
```bash
npm run download-pdfs
```

Place downloaded PDFs in the `raw/` folder.

**Step 2: Process Data**

```bash
# Install Python dependencies (for PDF extraction)
pip install pymupdf

# Run the data preparation script
npm run prepare-data
```

Or use the provided Python scripts:

```bash
python scripts/extract_pdf.py
python scripts/create_chunks.py
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
│   └── index.js        # MCP server implementation
├── scripts/
│   ├── extract_pdf.py  # PDF text extraction
│   └── create_chunks.js # Text chunking
├── data/
│   └── chunks.json     # Processed chunks (generated)
├── raw/                # Place PDFs here (not included)
├── package.json
└── README.md
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) file.

## Disclaimer

This project is not affiliated with 3GPP. 3GPP specifications are copyrighted by ETSI and 3GPP partners. Users are responsible for complying with 3GPP's terms of use when downloading and using specification documents.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [3GPP Specifications](https://www.3gpp.org/specifications)
