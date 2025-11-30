# Implementation Plan: 3GPP Document Search MCP Server

**Spec Reference**: [001-3gpp-document-search.md](../specs/001-3gpp-document-search.md)  
**Created**: 2025-12-01  
**Status**: Implemented  
**Target**: Node.js v18+ MCP Server

## Architecture Overview

```
┌─────────────────┐
│  Claude/AI SDK  │ (MCP Client)
└────────┬────────┘
         │ MCP Protocol (stdio)
         │
┌────────▼────────────────────────────────────┐
│  MCP Server (src/index.js)                  │
│  - 3 Tools: searchChunks, get_emm_cause,    │
│    get_5gmm_cause                            │
│  - Zod validation                            │
│  - Simple keyword search                     │
└──────────────┬──────────────────────────────┘
               │
         ┌─────▼─────┐
         │chunks.json│ (107MB, Git LFS)
         │22,408     │
         │chunks     │
         └───────────┘
```

## Technical Stack

### Core Dependencies

- **@modelcontextprotocol/sdk** (v1.0.0): MCP server framework
  - Provides `Server`, `StdioServerTransport`
  - Handles JSON-RPC communication
  
- **zod** (v4.1.13): Schema validation
  - Validates tool arguments
  - Type-safe input parsing

### Development Tools

- **Python 3.13+**: Data preprocessing scripts
  - PyMuPDF: PDF text extraction
  - tiktoken: Token counting
  
- **Git LFS**: Large file storage
  - Stores 107MB chunks.json
  - Auto-setup via postinstall.js

### Runtime Environment

- **Node.js**: v18+ (ESM modules)
- **Operating Systems**: Windows, macOS, Linux
- **Installation**: npm/npx (zero configuration)

## Component Design

### 1. MCP Server Core (`src/index.js`)

**Responsibilities**:
- Load chunks.json at startup (sync read for simplicity)
- Register 3 MCP tools (searchChunks, get_emm_cause, get_5gmm_cause)
- Validate inputs with Zod schemas
- Implement search logic (case-insensitive keyword matching)
- Return results in MCP-compliant format

**Key Functions**:

```javascript
// Tool 1: Document Search
searchChunks(query: string) -> Array<{text, spec}>
  - Filters chunks containing query (case-insensitive)
  - Returns matching chunks with source spec
  
// Tool 2: EMM Cause Lookup
get_emm_cause(value: number) -> string
  - Maps numeric cause to description
  - Covers 40 EMM causes (TS 24.301)
  
// Tool 3: 5GMM Cause Lookup
get_5gmm_cause(value: number) -> string
  - Maps numeric cause to description
  - Covers 35 5GMM causes (TS 24.501)
```

**Error Handling**:
- Invalid arguments → Zod validation error
- Empty query → Return error message
- No results → Return "No results found"
- Missing chunks.json → Fail fast with clear error

### 2. Data Pipeline (`scripts/`)

**Step 1: PDF Download** (`download-pdfs.js`)
- Fetches 17 specs from ETSI servers
- Handles filename transformations (e.g., ts_124008 → 24008)
- Saves to `pdfs/` directory

**Step 2: Text Extraction** (`create_chunks_simple.py`)
- Uses PyMuPDF to extract text from PDFs
- Splits into chunks (size=6000, overlap=100)
- Generates chunks.json with structure:
  ```json
  [
    {"text": "...", "spec": "TS 24.301"},
    {"text": "...", "spec": "TS 36.331"}
  ]
  ```

**Step 3: Git LFS Storage**
- Tracks chunks.json with Git LFS
- Reduces repository clone size
- Auto-downloads via postinstall.js

### 3. Auto-Installation (`scripts/postinstall.js`)

**Purpose**: Zero-configuration user experience

**Workflow**:
1. Check if chunks.json exists and is valid (>1MB)
2. If pointer file detected (Git LFS):
   - Check Git version
   - Install Git LFS if needed (OS-specific commands)
   - Run `git lfs pull` to download actual data
3. Verify file integrity
4. Report success/failure

**Platform Support**:
- Windows: `winget install --id Git.Git`
- macOS: `brew install git-lfs`
- Linux: `sudo apt-get install git-lfs` (Debian/Ubuntu)

## Data Flow

### Search Request Flow

```
1. Claude sends MCP request:
   {"method": "tools/call", "params": {"name": "searchChunks", "arguments": {"query": "attach"}}}

2. Server validates input (Zod)

3. Server filters chunks:
   chunks.filter(c => c.text.toLowerCase().includes("attach"))

4. Server returns results:
   {
     "content": [
       {"type": "text", "text": "Found 42 results:\n\n[TS 24.301] ...attach procedure..."}
     ]
   }
```

### Cause Code Lookup Flow

```
1. Claude sends MCP request:
   {"method": "tools/call", "params": {"name": "get_emm_cause", "arguments": {"value": 7}}}

2. Server looks up in hardcoded map:
   EMM_CAUSES[7] = "EPS services not allowed"

3. Server returns description:
   {
     "content": [
       {"type": "text", "text": "EMM Cause #7: EPS services not allowed"}
     ]
   }
```

## Performance Considerations

### Memory Management

- **Startup**: Load entire chunks.json into memory (~150MB)
- **Runtime**: No disk I/O during search (all in-memory)
- **Tradeoff**: Fast search vs. high memory usage

### Search Optimization

- **Current**: Simple `String.includes()` (O(n*m) worst case)
- **Future**: Consider Trie/Inverted Index for large datasets

### Scalability Limits

- **Max chunks**: ~50,000 (before memory issues)
- **Current**: 22,408 chunks (well within limit)
- **Concurrent clients**: Node.js single-threaded (10+ clients OK)

## Testing Strategy

### Unit Tests (Future Enhancement)

```javascript
// Test search functionality
test('searchChunks returns relevant results', () => {
  const results = searchChunks('attach procedure');
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].spec).toMatch(/TS 24\.(008|301|501)/);
});

// Test cause code lookup
test('get_emm_cause returns correct description', () => {
  const result = get_emm_cause(7);
  expect(result).toBe('EPS services not allowed');
});

// Test edge cases
test('empty query returns error', () => {
  expect(() => searchChunks('')).toThrow();
});
```

### Integration Tests

- **Install test**: `npx @lee-sihyeon/mcp-server-3gpp` on fresh machine
- **Git LFS test**: Clone repo without LFS, run postinstall.js
- **MCP test**: Connect Claude and execute sample queries

### Manual Testing Checklist

- [ ] Search for "attach procedure" returns NAS results
- [ ] EMM cause #7 returns "EPS services not allowed"
- [ ] 5GMM cause #11 returns "PLMN not allowed"
- [ ] Empty query returns error message
- [ ] Nonexistent cause code returns "Unknown" message
- [ ] postinstall.js succeeds on Windows/macOS/Linux
- [ ] Server starts within 2 seconds

## Deployment Strategy

### NPM Publishing

```bash
# Build and publish
npm version patch
npm publish --access public

# Users install with
npx @lee-sihyeon/mcp-server-3gpp
```

### Git LFS Hosting

- **GitHub LFS**: 1GB free storage (currently using 107MB)
- **Bandwidth**: 1GB/month free (each install = 107MB)
- **Cost**: $5/month for 50GB additional (if needed)

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "3gpp": {
      "command": "npx",
      "args": ["-y", "@lee-sihyeon/mcp-server-3gpp"]
    }
  }
}
```

## Risk Mitigation

### Risk 1: Git LFS Bandwidth Exhausted

- **Impact**: Users cannot download chunks.json
- **Mitigation**: 
  - Monitor bandwidth usage
  - Add alternative CDN hosting (if needed)
  - Consider chunking into smaller files

### Risk 2: Outdated Specifications

- **Impact**: Data becomes stale (3GPP updates specs quarterly)
- **Mitigation**:
  - Document update procedure in README
  - Add timestamp to chunks.json
  - Consider automated monthly regeneration

### Risk 3: Cross-Platform Compatibility

- **Impact**: postinstall.js fails on unknown OS
- **Mitigation**:
  - Test on Windows/macOS/Linux
  - Add fallback to manual instructions
  - Log detailed error messages

### Risk 4: Memory Exhaustion

- **Impact**: Server crashes on very large result sets
- **Mitigation**:
  - Limit search results to top 100
  - Add pagination in future version
  - Monitor memory usage in production

## Dependencies & Versioning

### Lock File Strategy

- **package-lock.json**: Committed to repo (ensures reproducibility)
- **engines**: `"node": ">=18.0.0"` (for ESM support)

### Dependency Security

- Run `npm audit` regularly
- Update MCP SDK when breaking changes occur
- Pin Zod to avoid validation logic changes

## Future Enhancements

1. **Semantic Search**: Add embeddings + vector DB (e.g., Pinecone)
2. **Spec Updates**: Automated monthly data regeneration
3. **Pagination**: Limit results to 50 per page
4. **Highlighting**: Mark query terms in results
5. **Fuzzy Search**: Support typos with Levenshtein distance
6. **Multi-language**: Add Korean translations (if NAD team needs)

## Implementation Timeline (Historical)

- **2025-11-20**: Initial 4 NAS specs + EMM causes
- **2025-11-22**: Git LFS integration (chunk_size 3000→6000)
- **2025-11-25**: Added 3 RRC specs (SIB support)
- **2025-11-26**: Added 4 PCT + 2 USIM + 2 IMS + 2 Architecture specs
- **2025-11-27**: postinstall.js auto-installation complete
- **2025-12-01**: SpecKit documentation added

## References

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [3GPP Specifications Portal](https://www.3gpp.org/ftp/Specs/archive/)
- [Git LFS Documentation](https://git-lfs.com/)
- [Zod Documentation](https://zod.dev/)
