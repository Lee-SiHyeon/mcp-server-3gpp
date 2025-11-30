# Feature Specification: 3GPP Document Search & Cause Code Lookup

**Feature Branch**: `001-3gpp-document-search`  
**Created**: 2025-12-01  
**Status**: Implemented  
**Purpose**: Enable AI agents to search 17 3GPP specifications and lookup EMM/5GMM cause codes via MCP

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Search NAS Protocol Specifications (Priority: P1)

AI agent needs to find information about "Attach procedure" in LTE/5G specifications.

**Why this priority**: Core functionality - enables basic document search across all supported specs.

**Independent Test**: Can be fully tested by querying "attach procedure" and verifying results contain relevant sections from TS 24.301 or TS 24.501.

**Acceptance Scenarios**:

1. **Given** chunks.json is loaded, **When** user searches "attach procedure", **Then** returns relevant text snippets from NAS specs (TS 24.008, 24.301, 24.501)
2. **Given** search query contains typos, **When** user searches "atach procedur", **Then** still returns fuzzy-matched results
3. **Given** multiple specs contain the term, **When** user searches "authentication", **Then** returns results sorted by relevance with spec name clearly indicated

---

### User Story 2 - Lookup EMM Cause Codes (Priority: P1)

AI agent needs to understand what "EMM cause #7" means.

**Why this priority**: Essential for debugging LTE attach failures - frequently used by NAD team.

**Independent Test**: Can be tested by calling `get_emm_cause` tool with value 7 and verifying description is returned.

**Acceptance Scenarios**:

1. **Given** EMM cause database is loaded, **When** user queries cause code 7, **Then** returns "EPS services not allowed"
2. **Given** user provides cause code 2, **When** queried, **Then** returns "IMSI unknown in HSS"
3. **Given** invalid cause code 999, **When** queried, **Then** returns clear error message "Unknown EMM cause"

---

### User Story 3 - Lookup 5GMM Cause Codes (Priority: P1)

AI agent needs to understand what "5GMM cause #11" means for 5G SA debugging.

**Why this priority**: Essential for 5G NR attach failures - critical for 5G deployment.

**Independent Test**: Can be tested by calling `get_5gmm_cause` tool with value 11 and verifying description.

**Acceptance Scenarios**:

1. **Given** 5GMM cause database is loaded, **When** user queries cause code 11, **Then** returns "PLMN not allowed"
2. **Given** user provides cause code 3, **When** queried, **Then** returns "Illegal UE"
3. **Given** invalid cause code 999, **When** queried, **Then** returns clear error message "Unknown 5GMM cause"

---

### User Story 4 - Search RRC Specifications (Priority: P2)

AI agent needs to find SIB (System Information Block) definitions.

**Why this priority**: Important for understanding cell broadcast information - used in RAN analysis.

**Independent Test**: Can be tested by searching "SIB1" and verifying results from TS 25.331, 36.331, or 38.331.

**Acceptance Scenarios**:

1. **Given** RRC specs are indexed, **When** user searches "SIB1", **Then** returns definitions from 3G/4G/5G RRC specs
2. **Given** user searches "cell reselection", **When** queried, **Then** returns relevant procedures from all RRC specs

---

### User Story 5 - Search PCT Test Specifications (Priority: P3)

AI agent needs to find protocol conformance test cases.

**Why this priority**: Nice-to-have for QA engineers - less frequently used than NAS/RRC.

**Independent Test**: Can be tested by searching "test case 9.2.1" and verifying results from TS 34.123-1 or 36.523-1.

**Acceptance Scenarios**:

1. **Given** PCT specs are indexed, **When** user searches "test case", **Then** returns test procedures from protocol testing specs

---

### Edge Cases

- What happens when **search query is empty**? → Returns error message "Query cannot be empty"
- What happens when **no results found**? → Returns "No results found for query: [query]"
- What happens when **chunks.json is corrupted**? → Server fails to start with clear error message
- What happens when **Git LFS pointer file** is present instead of actual data? → postinstall.js detects and auto-downloads
- What happens when **search query is too long (>1000 chars)**? → Query is truncated with warning message

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST index and search across 17 3GPP specifications (NAS, RRC, PCT, USIM, IMS, Architecture)
- **FR-002**: System MUST provide EMM cause code lookup (40 causes) with descriptions
- **FR-003**: System MUST provide 5GMM cause code lookup (35 causes) with descriptions
- **FR-004**: System MUST support keyword search with basic fuzzy matching
- **FR-005**: System MUST return results with spec name, page/section context
- **FR-006**: System MUST handle search queries via MCP protocol (Model Context Protocol)
- **FR-007**: System MUST load pre-built chunks.json at startup (no on-demand indexing)
- **FR-008**: System MUST support automatic Git LFS setup and data download via postinstall.js
- **FR-009**: System MUST work cross-platform (Windows/macOS/Linux)
- **FR-010**: System MUST validate MCP tool arguments using Zod schemas

### Key Entities *(include if feature involves data)*

- **Chunk**: Text segment from a 3GPP spec
  - Attributes: `text` (content), `spec` (source specification)
  - Size: 6000 characters with 100 character overlap
  - Total: 22,408 chunks

- **EMM Cause**: LTE attach/detach failure reason
  - Attributes: `value` (numeric code), `description` (human-readable explanation)
  - Count: 40 causes

- **5GMM Cause**: 5G NR attach/detach failure reason
  - Attributes: `value` (numeric code), `description` (human-readable explanation)
  - Count: 35 causes

- **Specification**: 3GPP technical specification document
  - Categories: NAS (4), RRC (3), PCT (4), USIM (2), IMS (2), Architecture (2)
  - Format: PDF → Text extraction → Chunked JSON

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: AI agent can find relevant information within 1 second for 95% of queries
- **SC-002**: Search returns at least 1 relevant result for 90% of valid queries
- **SC-003**: EMM/5GMM cause lookup returns correct description 100% of the time for valid codes
- **SC-004**: Installation succeeds on first try for 90% of users (with automatic Git LFS setup)
- **SC-005**: Memory usage stays under 200MB during normal operation
- **SC-006**: System supports at least 10 concurrent MCP client connections

## Technical Context *(for reference only)*

### Supported Specifications

**NAS (Non-Access Stratum)**:
- TS 24.008 - 2G/3G NAS
- TS 24.301 - 4G LTE NAS
- TS 24.501 - 5G NR NAS

**RRC (Radio Resource Control)**:
- TS 25.331 - 3G UMTS RRC
- TS 36.331 - 4G LTE RRC
- TS 38.331 - 5G NR RRC

**PCT (Protocol Conformance Testing)**:
- TS 34.123-1 - 3G Protocol Testing
- TS 36.523-1 - 4G LTE Protocol Testing

**USIM (Universal Subscriber Identity Module)**:
- TS 31.102 - USIM Application
- TS 31.111 - USIM Toolkit

**IMS (IP Multimedia Subsystem)**:
- TS 24.229 - IMS Call Control
- TS 24.628 - XCAP Protocol

**Architecture**:
- TS 23.002 - Network Architecture
- TS 23.401 - GPRS Architecture

### Data Processing Pipeline

1. **PDF Download**: Automated scripts fetch latest versions from ETSI
2. **Text Extraction**: PyMuPDF extracts text from PDFs
3. **Chunking**: Text split into 6000-character chunks with 100-char overlap
4. **Storage**: chunks.json (107MB) stored via Git LFS
5. **Loading**: Server loads entire dataset into memory at startup

### Performance Characteristics

- Startup time: ~2 seconds (loading 22,408 chunks)
- Search latency: <100ms for typical queries
- Memory footprint: ~150MB (chunks + Node.js runtime)
- Dataset size: 107.2 MB (Git LFS)

## Known Limitations

- **No semantic search**: Uses simple keyword matching (no embeddings)
- **English only**: All specifications are in English
- **Static dataset**: Requires manual regeneration for spec updates
- **No pagination**: Returns all matching results (could be large)
- **Case-sensitive**: Search is case-insensitive but may miss variations
