# 3GPP MCP Server - Project Constitution

## Project Purpose
Provide 17 3GPP specifications as an MCP (Model Context Protocol) server, enabling AI agents to:
- Search and retrieve 3GPP documentation (NAS, RRC, PCT, USIM, IMS, Architecture)
- Look up EMM cause codes (LTE)
- Look up 5GMM cause codes (5G NR)

## Technical Stack

### Core Technologies
- **Runtime**: Node.js 24.10.0
- **MCP SDK**: @modelcontextprotocol/sdk v1.0.0
- **Validation**: Zod v4.1.13
- **Language**: JavaScript (ES modules)

### Data Processing
- **PDF Extraction**: PyMuPDF (Python 3.13.1)
- **Chunking**: Simple text splitting
  - chunk_size: 6000 characters
  - overlap: 100 characters
  - Total: 22,408 chunks
  - Size: 107.2 MB

### Storage
- **Version Control**: Git with Git LFS
- **Large Files**: Git LFS for `data/chunks.json` (107MB)
- **Tracking**: `.gitattributes` configuration

## Supported Specifications

### NAS (Non-Access Stratum)
1. TS 24.008 - 2G/3G NAS
2. TS 24.301 - 4G LTE NAS
3. TS 24.501 - 5G NR NAS

### RRC (Radio Resource Control)
4. TS 25.331 - 3G UMTS RRC
5. TS 36.331 - 4G LTE RRC
6. TS 38.331 - 5G NR RRC

### PCT (Protocol Conformance Testing)
7. TS 34.123-1 - 3G Protocol Testing
8. TS 36.523-1 - 4G LTE Protocol Testing

### USIM (Universal Subscriber Identity Module)
9. TS 31.102 - USIM Application
10. TS 31.111 - USIM Toolkit

### IMS (IP Multimedia Subsystem)
11. TS 24.229 - IMS Call Control
12. TS 24.628 - XCAP Protocol

### Architecture
13. TS 23.002 - Network Architecture
14. TS 23.401 - GPRS Architecture

## Development Principles

### 1. User Experience
- **Zero Configuration**: `npm install -g mcp-server-3gpp` should work immediately
- **Auto Installation**: postinstall.js handles Git LFS setup and data download
- **Platform Support**: Windows (winget/chocolatey), macOS (brew), Linux (apt-get)

### 2. Code Quality
- **Error Handling**: Try-catch blocks for all external operations
- **Validation**: Zod schemas for MCP tool arguments
- **Fallback**: Direct HTTPS download if Git LFS fails

### 3. Data Integrity
- **Pre-built Data**: Users receive ready-to-use chunks.json
- **Version Control**: Manifest tracking for updates
- **Backup**: Users can regenerate data with `npm run setup`

### 4. Performance
- **Efficient Search**: Simple text matching (no vector DB overhead)
- **Memory Management**: Chunks loaded once at startup
- **Response Time**: < 1 second for keyword searches

## Deployment Strategy

### Installation Flow
1. User runs: `npm install -g mcp-server-3gpp`
2. postinstall.js executes:
   - Check if chunks.json exists
   - Detect Git LFS pointer (file size < 1KB)
   - Install Git LFS if missing (platform-specific)
   - Download chunks.json via `git lfs pull`
   - Fallback: Direct HTTPS download from GitHub
3. Server ready to use

### Platform-Specific Installation
```bash
# Windows
winget install -e --id GitHub.GitLFS
# or
choco install git-lfs -y

# macOS
brew install git-lfs

# Linux
sudo apt-get install git-lfs
```

## Historical Context

### Key Decisions

#### Why Git LFS?
- GitHub 100MB file size limit
- chunks.json is 107.2 MB
- Tried chunking optimization first (failed to reduce below 107MB)
- Git LFS allows seamless large file handling

#### Why chunk_size=6000?
- Initial: 3000 (36,861 chunks, 113.7 MB) - too large
- Tried: 4000, 5000 - still > 110 MB
- Final: 6000 with overlap=100 → 22,408 chunks, 107.2 MB ✅

#### Why Automatic Installation?
- Manual Git LFS setup is error-prone
- Users complained about "pointer file" errors
- postinstall.js eliminates friction
- Supports 90%+ installation success rate

### Data Structure Evolution
- **PR #1**: Initial chunks.json with `content` and `metadata.source`
- **PR #2**: Changed to `text` and `spec` for better compatibility
- **Current**: `{ text: string, spec: string }` format

## Team Collaboration

### For NAD Team
- **Use Case**: Quick reference for SIB, RRC, PCT specifications
- **Access**: via MCP clients (Claude Desktop, Cursor, etc.)
- **Search**: Natural language queries → relevant spec sections

### For Future Developers
1. **Adding New Specs**:
   - Add spec number to `scripts/download-pdfs.js`
   - Run `npm run download`
   - Run `npm run prepare-data` to regenerate chunks.json
   - Commit via Git LFS

2. **Modifying Search**:
   - Edit `src/index.js` → `searchChunks()` function
   - Keep it simple (avoid complex NLP)
   - Test with `node test_search.js`

3. **Updating Dependencies**:
   - MCP SDK updates: Check breaking changes
   - Zod updates: Verify schema compatibility

## Quality Standards

### Testing
- **Manual Testing**: test_search.js with sample queries
- **No Unit Tests**: Simple codebase doesn't warrant overhead
- **Integration Testing**: Real MCP client (Claude Desktop) testing

### Documentation
- **README.md**: User-facing instructions
- **CLAUDE.md**: Developer context (this file)
- **Code Comments**: Minimal (self-explanatory code preferred)

## Support & Maintenance

### Known Limitations
- **Search**: Basic keyword matching (no semantic search)
- **Language**: English-only documentation
- **Platform**: Git LFS may require manual setup on restricted networks
- **Size**: 107MB download may be slow on poor connections

### Future Enhancements (Nice-to-Have)
- Semantic search with embeddings
- Incremental spec updates
- Multi-language support
- Web UI for non-MCP usage

## License
MIT License - Public use encouraged

---

Last Updated: 2025-12-01
Version: 1.0.0 (stable)
Maintainer: Lee-SiHyeon
Repository: https://github.com/Lee-SiHyeon/mcp-server-3gpp
