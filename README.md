# mcp-server-3gpp

🔍 **MCP Server for 3GPP Specification Document Search**

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI assistants to search and retrieve information from 3GPP specification documents.

## Features

- 📚 **Search 3GPP Documents**: Full-text search across 3GPP specifications
- 📋 **EMM/5GMM Cause Lookup**: Quick reference for LTE and 5G NAS cause values
- 🌐 **Supports Multiple Specs**: TS 24.008, TS 24.301, TS 24.501, TS 36.300

## Available Tools

| Tool | Description |
|------|-------------|
| `search_3gpp_docs` | Search 3GPP documents by keywords |
| `get_emm_cause` | Get EMM cause (LTE) or 5GMM cause (5G) details |
| `list_specs` | List available specifications |

## Installation

### Prerequisites

- Node.js >= 18.0.0
- 3GPP specification PDFs (see [Data Preparation](#data-preparation))

### Quick Start

```bash
# Clone the repository
git clone https://github.com/Lee-SiHyeon/mcp-server-3gpp.git
cd mcp-server-3gpp

# Install dependencies
npm install

# Prepare data (see Data Preparation section first)
npm run prepare-data

# Test the server
npm start
```

## Data Preparation

Due to licensing, 3GPP specification PDFs are not included. You need to download and process them yourself.

### Step 1: Download 3GPP Specifications

Download the following PDFs from [3GPP Specifications](https://www.3gpp.org/specifications):

| Spec | Description | Download |
|------|-------------|----------|
| TS 24.008 | 2G/3G NAS (MM/GMM/SM) | [Link](https://www.3gpp.org/DynaReport/24008.htm) |
| TS 24.301 | LTE NAS (EMM/ESM) | [Link](https://www.3gpp.org/DynaReport/24301.htm) |
| TS 24.501 | 5G NAS (5GMM/5GSM) | [Link](https://www.3gpp.org/DynaReport/24501.htm) |
| TS 36.300 | E-UTRA Overall Description | [Link](https://www.3gpp.org/DynaReport/36300.htm) |

Place downloaded PDFs in the `raw/` folder.

### Step 2: Extract and Chunk Text

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
