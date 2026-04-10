/**
 * get_ingest_guide — Operational knowledge tool
 *
 * Returns step-by-step instructions for downloading ETSI specs, RFC documents,
 * and running the AutoRAG extraction pipeline. Use when a document is missing
 * from the corpus and you need to ingest it.
 */

import { formatSuccess, formatError } from './helpers.js';

export const GUIDES = {
  etsi: {
    title: 'Downloading ETSI/3GPP Specs',
    description: 'Download 3GPP specs from the ETSI portal as PDFs and ingest them into the corpus.',
    steps: [
      {
        step: 1,
        action: 'Navigate to repo working directory',
        command: 'cd ~/mcp-server-3gpp',
      },
      {
        step: 2,
        action: 'Download specific 3GPP TS by series+doc number',
        command: 'python scripts/download_etsi_specs.py --spec 29.502 --type ts',
        notes: 'Types: ts (Technical Specification), tr (Technical Report), en (European Norm). Use --latest-only to skip older versions.',
      },
      {
        step: 3,
        action: 'Download an entire series (e.g. all TS 29.5xx)',
        command: 'python scripts/download_etsi_specs.py --series 29 --type ts --range 500 599',
        notes: 'Brute-forces ETSI number range. Only downloads PDFs that exist (_60 published suffix).',
      },
      {
        step: 4,
        action: 'ETSI URL pattern (for manual download)',
        pattern: 'https://www.etsi.org/deliver/etsi_{type}/{range}/{etsi_num}/{ver}_60/{type}_{etsi_num}v{ver_compact}p.pdf',
        example: 'TS 29.502 v18.5.0 → https://www.etsi.org/deliver/etsi_ts/129500_129599/129502/18.05.00_60/ts_129502v180500p.pdf',
        notes: 'ETSI number = 100000 + (series * 1000) + doc_num. Range = floor(etsi_num/100)*100 to +99.',
      },
      {
        step: 5,
        action: 'Run AutoRAG pipeline after download (see autorag guide)',
        command: 'bash scripts/run_pipeline.sh --spec ts_29_502',
      },
    ],
    directories: {
      pdfs: 'data/pdfs/',
      raw: 'raw/',
      manifest: 'data/pdfs/manifest.json',
    },
  },

  rfc: {
    title: 'Downloading IETF RFC Documents',
    description: 'Download RFC text documents from rfc-editor.org and ingest them into the corpus.',
    steps: [
      {
        step: 1,
        action: 'Download specific RFCs',
        command: 'python scripts/download_rfc.py --rfc 3261 --rfc 6733 --rfc 8446',
        notes: 'Downloads TXT + metadata JSON per RFC to data/rfcs/. Fetches abstract/title/status from IETF Datatracker API.',
      },
      {
        step: 2,
        action: 'Download all priority telecom RFCs',
        command: 'python scripts/download_rfc.py --all',
        notes: 'Downloads ~80 priority RFCs covering SIP, Diameter, RADIUS, IKEv2, TLS, OAuth, QUIC, HTTP, SCTP, DNS, BGP, OSPF, NETCONF/YANG, XMPP, WebRTC, RTP, NTP, etc.',
      },
      {
        step: 3,
        action: 'RFC direct URL pattern',
        pattern: 'https://www.rfc-editor.org/rfc/rfcNNNN.txt',
        example: 'RFC 3261 (SIP) → https://www.rfc-editor.org/rfc/rfc3261.txt',
      },
      {
        step: 4,
        action: 'RFC metadata API',
        pattern: 'https://datatracker.ietf.org/api/v1/doc/document/rfcNNNN/?format=json',
        example: 'https://datatracker.ietf.org/api/v1/doc/document/rfc3261/?format=json',
        notes: 'Returns: title, abstract, pages, rfc_number, std_level (std/ps/inf/exp/bcp), stream.',
      },
      {
        step: 5,
        action: 'Extract RFC structure to JSONL',
        command: 'python scripts/extract_rfc_structure.py --rfc 3261',
        notes: 'Parses TXT format: extracts TOC and section content. Outputs *_toc.jsonl + *_sections.jsonl to data/intermediate/.',
      },
      {
        step: 6,
        action: 'Load RFC sections into SQLite DB',
        command: 'node src/ingest/loadRfcSections.js --rfc 3261',
        notes: 'spec_id format: rfc_3261. Section IDs: rfc_3261:1.2.3. source_type=rfc in ingestion_runs.',
      },
      {
        step: 7,
        action: 'Run full RFC pipeline (download + extract + load)',
        command: 'bash scripts/run_rfc_pipeline.sh --rfc 3261',
        or: 'npm run rfc:pipeline -- --rfc 3261',
      },
    ],
    directories: {
      rfcs: 'data/rfcs/',
      intermediate: 'data/intermediate/',
      manifest: 'data/rfcs/manifest.json',
    },
    priorityCategories: {
      'SIP/VoIP': [3261, 3262, 3263, 3264, 3265, 4566],
      'Diameter': [6733, 3588, 4005, 4006],
      'RADIUS': [2865, 2866, 3162],
      'Security': [7296, 8446, 9147, 4251, 4252, 4253, 4254],
      'OAuth/JWT': [6749, 6750, 7519],
      'HTTP': [9110, 9112, 9113, 9114],
      'QUIC': [9000, 9001, 9002],
      'SCTP': [4960],
      'DNS': [1034, 1035, 4033, 4034, 4035],
      'Routing': [4271, 2328, 5340, 3031],
      'NETCONF/YANG': [6241, 7950],
      'IPv6/NAT': [8200, 6877, 6146, 6147],
      'WebRTC': [8825, 8826, 8827, 8834, 8835],
      'RTP': [3550, 3551],
    },
  },

  autorag: {
    title: 'Running the AutoRAG Extraction Pipeline',
    description: 'Full pipeline: PDF/TXT → structure extraction → section spans → SQLite DB ingestion.',
    steps: [
      {
        step: 1,
        action: 'Full pipeline for a downloaded PDF spec',
        command: 'bash scripts/run_pipeline.sh --spec ts_29_502',
        notes: 'Runs: extract_pdf_structure.py → build_section_spans.py → loadDatabase.js',
      },
      {
        step: 2,
        action: 'Extract TOC + page text from PDF',
        command: 'python scripts/extract_pdf_structure.py --spec ts_29_502',
        outputs: ['data/intermediate/ts_29_502_toc.jsonl', 'data/intermediate/ts_29_502_pages.jsonl'],
        notes: 'Uses PyMuPDF. Input PDF: data/pdfs/ts_29_502_v*.pdf',
      },
      {
        step: 3,
        action: 'Build section spans from TOC + pages',
        command: 'python scripts/build_section_spans.py --spec ts_29_502',
        output: 'data/intermediate/ts_29_502_sections.jsonl',
        notes: 'Reconciles TOC entries with page text to produce section boundaries + content.',
      },
      {
        step: 4,
        action: 'Load sections into SQLite corpus',
        command: 'node src/ingest/loadDatabase.js --spec ts_29_502',
        notes: 'Inserts into specs, toc, sections tables. FTS5 index auto-updated via triggers. Idempotent — skips if already loaded.',
      },
      {
        step: 5,
        action: 'Process ALL downloaded PDFs at once',
        command: 'python scripts/extract_pdf_structure.py --all && python scripts/build_section_spans.py --all && node src/ingest/loadDatabase.js --all',
      },
      {
        step: 6,
        action: 'Verify corpus state',
        command: '~/bin/sqlite3 data/corpus/3gpp.db "SELECT id, title, total_sections FROM specs ORDER BY id;"',
      },
      {
        step: 7,
        action: 'Test FTS5 search after ingestion',
        command: '~/bin/sqlite3 data/corpus/3gpp.db "SELECT spec_id, section_number, section_title FROM sections_fts WHERE sections_fts MATCH \'your query\' LIMIT 10;"',
      },
    ],
    dbPath: 'data/corpus/3gpp.db',
    schemaFile: 'db/schema.sql',
    tables: ['specs', 'toc', 'sections', 'sections_fts (FTS5)', 'ingestion_runs'],
    npmScripts: {
      'etsi:download': 'python scripts/download_etsi_specs.py',
      'rfc:pipeline': 'bash scripts/run_rfc_pipeline.sh',
      'rfc:all': 'bash scripts/run_rfc_pipeline.sh --all',
    },
  },
};

export const getIngestGuideSchema = {
  name: 'get_ingest_guide',
  description: `Returns step-by-step operational instructions for expanding the 3GPP/RFC corpus.
Use this tool when:
- A document is missing from the corpus and needs to be downloaded and ingested
- You need to know the ETSI URL pattern for a specific spec
- You want to run the AutoRAG pipeline after downloading new PDFs
- You need to add RFC documents (SIP, Diameter, TLS, OAuth, QUIC, etc.) to the corpus

Three guides available:
- "etsi": Download 3GPP specs from ETSI portal (ts/tr/en types, series-level bulk download)
- "rfc": Download IETF RFC documents and ingest them (priority list included)
- "autorag": Run the full extraction pipeline (PDF→JSONL→SQLite)`,
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['etsi', 'rfc', 'autorag', 'all'],
        description: 'Which guide to return. Use "all" to get all three guides at once.',
      },
    },
    required: ['type'],
  },
};

export function handleGetIngestGuide(args) {
  const { type } = args;

  let result;
  if (type === 'all') {
    result = { guides: GUIDES };
  } else if (GUIDES[type]) {
    result = { guide: GUIDES[type] };
  } else {
    return formatError({
      error: `Unknown guide type: ${type}`,
      available: Object.keys(GUIDES).concat(['all']),
    });
  }

  return formatSuccess(result);
}
