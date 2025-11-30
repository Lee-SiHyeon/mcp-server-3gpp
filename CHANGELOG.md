# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-12-01

### Added
- **Testing Suite**: Comprehensive test coverage with 13 acceptance scenarios
  - `test_speckit_userstories.js`: Tests all SpecKit user stories
  - `validate.js`: Data structure and server validation
  - `npm test` and `npm run validate` commands
- **MCP SDK v1.0.0 Compatibility**: Full support for `structuredContent` responses
  - All tools now return both human-readable text and structured data
  - Enables programmatic processing by AI clients
- **Documentation Updates**:
  - Added Testing & Validation section
  - Response format documentation with examples
  - Updated project structure to include test files

### Changed
- Version bump to 1.1.0 reflecting new features
- Enhanced package.json description with test suite mention
- Improved README with testing instructions

### Fixed
- Added missing `structuredContent` field to empty search results
- Ensured consistent response structure across all tools

## [1.0.0] - 2025-11-30

### Added
- Initial release
- MCP Server implementation with 3 tools:
  - `search_3gpp_docs`: Full-text search across specifications
  - `get_emm_cause`: EMM/5GMM cause lookup
  - `list_specs`: List available specifications
- Pre-built data with 17 specifications (22,408 chunks, ~107MB)
  - 4 NAS specs (TS 24.008, 24.301, 24.501, 36.300)
  - 3 RRC specs (TS 25.331, 36.331, 38.331)
  - 4 PCT specs (TS 51.010-1, 34.123-1, 36.523-1, 38.523-1)
  - 2 USIM/USAT specs (TS 31.121, 31.124)
  - 2 IMS specs (TS 34.229-1, 34.229-5)
  - 2 Architecture specs (TS 38.300, TR 37.901)
- Git LFS support for large data files
- Automatic download scripts:
  - `scripts/download_pct_specs.py`: PCT specifications
  - `scripts/download_rrc_specs.py`: RRC specifications
- SpecKit documentation:
  - `.specify/constitution.md`: Project context
  - `.specify/specs/`: Feature specifications
  - `.specify/plans/`: Implementation plans
  - `.specify/tasks/`: Task breakdowns
- Python scripts for data processing:
  - `scripts/extract_pdf.py`: PDF text extraction
  - `scripts/create_chunks_simple.py`: Text chunking
- Node.js postinstall automation

### Documentation
- Comprehensive README with:
  - Installation instructions
  - Configuration examples (VS Code, Claude Desktop)
  - Usage examples
  - EMM/5GMM cause quick reference
  - Data preparation guide
  - SpecKit developer documentation

[1.1.0]: https://github.com/Lee-SiHyeon/mcp-server-3gpp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Lee-SiHyeon/mcp-server-3gpp/releases/tag/v1.0.0
