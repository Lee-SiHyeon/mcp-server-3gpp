import { getConnection } from '../db/connection.js';
import { ensureCatalogSchema } from '../db/catalogSchema.js';
import { formatError, formatSuccess } from './helpers.js';

export const getEtsiDocumentSchema = {
  name: 'get_etsi_document',
  description: 'Get one ETSI catalog document with version and optional file metadata. Use after search_etsi_catalog to inspect latest and historical versions.',
  inputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string', description: 'ETSI catalog document ID, e.g. etsi_ts_124501' },
      publicationType: { type: 'string', description: 'ETSI publication type when using etsiNumber, e.g. etsi_ts' },
      etsiNumber: { type: 'string', description: 'ETSI document number, e.g. 124501' },
      mapped3gppSpec: { type: 'string', description: 'Mapped 3GPP spec, e.g. TS 24.501 or ts_24_501' },
      includeFiles: { type: 'boolean', description: 'Include cataloged file rows for returned versions' },
      maxVersions: { type: 'number', description: 'Maximum versions to return, default 25, max 200' },
    },
  },
};

export function handleGetEtsiDocument(args = {}) {
  const db = getConnection();
  ensureCatalogSchema(db);

  const { whereSql, params } = buildDocumentLookup(args);
  if (!whereSql) {
    return formatError('documentId, mapped3gppSpec, or publicationType+etsiNumber is required');
  }

  const document = db.prepare(`
    SELECT
      d.id,
      d.publication_type,
      d.etsi_number,
      d.range_name,
      d.source_url,
      d.mapped_3gpp_id,
      d.mapped_3gpp_spec,
      d.latest_version,
      d.version_count,
      coalesce(file_counts.file_count, 0) AS file_count,
      coalesce(ds.selected_for_ingest, 0) AS selected_for_ingest,
      ds.selection_reason,
      coalesce(ds.download_status, 'not_selected') AS download_status,
      coalesce(ds.extract_status, 'not_selected') AS extract_status,
      coalesce(ds.embedding_status, 'not_selected') AS embedding_status,
      ds.latest_cataloged_version_id,
      ds.downloaded_file_path,
      ds.extracted_spec_id,
      ds.last_error,
      coalesce(ds.retry_count, 0) AS retry_count,
      s.id AS ingested_spec_id,
      s.title AS ingested_title,
      s.version AS ingested_version,
      s.total_sections AS ingested_sections
    FROM etsi_documents d
    LEFT JOIN etsi_document_status ds ON ds.document_id = d.id
    LEFT JOIN (
      SELECT document_id, count(*) AS file_count
      FROM etsi_files
      GROUP BY document_id
    ) file_counts ON file_counts.document_id = d.id
    LEFT JOIN specs s ON s.id = d.mapped_3gpp_id
    WHERE ${whereSql}
    ORDER BY d.publication_type, d.etsi_number
    LIMIT 1
  `).get(...params);

  if (!document) {
    return formatError('ETSI catalog document not found');
  }

  const maxVersions = Math.min(Math.max(Number(args.maxVersions ?? 25), 1), 200);
  const versions = db.prepare(`
    SELECT id, version, suffix, source_url, directory_modified_at, file_count
    FROM etsi_versions
    WHERE document_id = ?
    ORDER BY version DESC, suffix DESC
    LIMIT ?
  `).all(document.id, maxVersions);

  let filesByVersion = {};
  if (args.includeFiles && versions.length > 0) {
    const versionIds = versions.map(version => version.id);
    const placeholders = versionIds.map(() => '?').join(',');
    const files = db.prepare(`
      SELECT version_id, filename, file_url, file_type, size_bytes, modified_at
      FROM etsi_files
      WHERE version_id IN (${placeholders})
      ORDER BY version_id DESC, filename
    `).all(...versionIds);

    filesByVersion = Object.groupBy
      ? Object.groupBy(files, file => file.version_id)
      : groupByVersion(files);
  }

  return formatSuccess({
    document,
    versions: versions.map(version => ({
      ...version,
      files: args.includeFiles ? (filesByVersion[version.id] ?? []) : undefined,
    })),
  });
}

function buildDocumentLookup(args) {
  if (args.documentId) {
    return { whereSql: 'd.id = ?', params: [String(args.documentId).trim().toLowerCase()] };
  }

  if (args.publicationType && args.etsiNumber) {
    return {
      whereSql: 'd.publication_type = ? AND d.etsi_number = ?',
      params: [normalizePublicationType(args.publicationType), String(args.etsiNumber).trim()],
    };
  }

  if (args.mapped3gppSpec) {
    const mapped = normalizeMappedSpec(args.mapped3gppSpec);
    return {
      whereSql: '(d.mapped_3gpp_id = ? OR d.mapped_3gpp_spec = ?)',
      params: [mapped.id, mapped.label],
    };
  }

  return { whereSql: '', params: [] };
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

function groupByVersion(files) {
  return files.reduce((acc, file) => {
    if (!acc[file.version_id]) acc[file.version_id] = [];
    acc[file.version_id].push(file);
    return acc;
  }, {});
}
