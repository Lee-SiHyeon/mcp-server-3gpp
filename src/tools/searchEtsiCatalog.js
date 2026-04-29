import { getConnection } from '../db/connection.js';
import { ensureCatalogSchema } from '../db/catalogSchema.js';
import { formatSuccess } from './helpers.js';

export const searchEtsiCatalogSchema = {
  name: 'search_etsi_catalog',
  description: 'Search the ETSI delivery catalog metadata. This searches cataloged documents and versions, including documents that have not been downloaded or embedded yet.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to match against ETSI number, 3GPP mapping, or document ID' },
      publicationType: { type: 'string', description: 'Filter by ETSI publication type, e.g. etsi_ts, etsi_tr, etsi_en' },
      mapped3gppSpec: { type: 'string', description: 'Filter by mapped 3GPP spec, e.g. TS 24.501 or ts_24_501' },
      range: { type: 'string', description: 'Filter by ETSI range directory, e.g. 124300_124399' },
      onlyIngested: { type: 'boolean', description: 'Only return catalog documents already present in the extracted corpus' },
      hasVersions: { type: 'boolean', description: 'Filter by whether cataloged version rows exist' },
      hasFiles: { type: 'boolean', description: 'Filter by whether cataloged file rows exist' },
      selectedForIngest: { type: 'boolean', description: 'Filter by explicit ingest selection status' },
      ingestStatus: { type: 'string', description: 'Filter by download/extract/embedding status value' },
      maxResults: { type: 'number', description: 'Maximum documents to return, default 25, max 100' },
    },
  },
};

export function handleSearchEtsiCatalog(args = {}) {
  const db = getConnection();
  ensureCatalogSchema(db);

  const limit = Math.min(Math.max(Number(args.maxResults ?? 25), 1), 100);
  const conditions = [];
  const params = [];

  if (args.query) {
    const escaped = escapeLike(args.query);
    conditions.push(`(
      d.id LIKE ? ESCAPE '^'
      OR d.etsi_number LIKE ? ESCAPE '^'
      OR d.mapped_3gpp_id LIKE ? ESCAPE '^'
      OR d.mapped_3gpp_spec LIKE ? ESCAPE '^'
    )`);
    params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }

  if (args.publicationType) {
    conditions.push('d.publication_type = ?');
    params.push(normalizePublicationType(args.publicationType));
  }

  if (args.mapped3gppSpec) {
    const mapped = normalizeMappedSpec(args.mapped3gppSpec);
    conditions.push('(d.mapped_3gpp_id = ? OR d.mapped_3gpp_spec = ?)');
    params.push(mapped.id, mapped.label);
  }

  if (args.range) {
    conditions.push('d.range_name = ?');
    params.push(args.range);
  }

  if (args.onlyIngested) {
    conditions.push('s.id IS NOT NULL');
  }
  if (typeof args.hasVersions === 'boolean') {
    conditions.push(args.hasVersions ? 'd.version_count > 0' : 'd.version_count = 0');
  }
  if (typeof args.hasFiles === 'boolean') {
    conditions.push(args.hasFiles ? 'file_counts.file_count > 0' : 'coalesce(file_counts.file_count, 0) = 0');
  }
  if (typeof args.selectedForIngest === 'boolean') {
    conditions.push('coalesce(ds.selected_for_ingest, 0) = ?');
    params.push(args.selectedForIngest ? 1 : 0);
  }
  if (args.ingestStatus) {
    conditions.push(`(
      ds.download_status = ?
      OR ds.extract_status = ?
      OR ds.embedding_status = ?
    )`);
    params.push(args.ingestStatus, args.ingestStatus, args.ingestStatus);
  }

  let sql = `
    SELECT
      d.id,
      d.publication_type,
      d.etsi_number,
      d.range_name,
      d.mapped_3gpp_id,
      d.mapped_3gpp_spec,
      d.latest_version,
      d.version_count,
      d.source_url,
      coalesce(file_counts.file_count, 0) AS file_count,
      coalesce(ds.selected_for_ingest, 0) AS selected_for_ingest,
      coalesce(ds.download_status, 'not_selected') AS download_status,
      coalesce(ds.extract_status, 'not_selected') AS extract_status,
      coalesce(ds.embedding_status, 'not_selected') AS embedding_status,
      ds.selection_reason,
      s.id AS ingested_spec_id,
      s.title AS ingested_title,
      s.total_sections AS ingested_sections
    FROM etsi_documents d
    LEFT JOIN etsi_document_status ds ON ds.document_id = d.id
    LEFT JOIN (
      SELECT document_id, count(*) AS file_count
      FROM etsi_files
      GROUP BY document_id
    ) file_counts ON file_counts.document_id = d.id
    LEFT JOIN specs s ON s.id = d.mapped_3gpp_id
  `;

  if (conditions.length) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY d.publication_type, d.etsi_number LIMIT ?';
  params.push(limit);

  const documents = db.prepare(sql).all(...params);
  const status = getCatalogStatus(db);
  return formatSuccess({ status, documents });
}

function getCatalogStatus(db) {
  const tables = [
    ['publication_types', 'etsi_publication_types'],
    ['ranges', 'etsi_ranges'],
    ['documents', 'etsi_documents'],
    ['versions', 'etsi_versions'],
    ['files', 'etsi_files'],
  ];
  const counts = Object.fromEntries(
    tables.map(([name, table]) => [name, db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count])
  );
  const lastRun = db.prepare(`
    SELECT id, status, depth, requests_made, completed_at
    FROM catalog_crawl_runs
    ORDER BY id DESC
    LIMIT 1
  `).get() ?? null;
  return { counts, lastRun };
}

function normalizePublicationType(value) {
  const normalized = String(value).trim().toLowerCase();
  return normalized.startsWith('etsi_') ? normalized : `etsi_${normalized}`;
}

function normalizeMappedSpec(value) {
  const trimmed = String(value).trim();
  const idLike = trimmed.toLowerCase().replace(/[\s.-]+/g, '_');
  if (/^(ts|tr)_\d{2}_\d{3}(?:_\d+)?$/.test(idLike)) {
    const parts = idLike.split('_');
    const label = `${parts[0].toUpperCase()} ${parts[1]}.${parts[2]}${parts[3] ? `-${Number(parts[3])}` : ''}`;
    return { id: idLike, label };
  }

  const match = /^(TS|TR)\s*(\d{2})\.(\d{3})(?:-(\d+))?$/i.exec(trimmed);
  if (!match) {
    return { id: idLike, label: trimmed.toUpperCase() };
  }
  const [, type, series, doc, subpart] = match;
  return {
    id: `${type.toLowerCase()}_${series}_${doc}${subpart ? `_${Number(subpart)}` : ''}`,
    label: `${type.toUpperCase()} ${series}.${doc}${subpart ? `-${Number(subpart)}` : ''}`,
  };
}

function escapeLike(value) {
  return String(value).replace(/[%_^]/g, '^$&');
}
