import {
  EMBEDDING_DIM,
  EMBEDDING_POLICY_VERSION,
  MODEL_NAME,
  PASSAGE_PREFIX,
  PREFIX_POLICY_VERSION,
  QUERY_PREFIX,
} from './pipeline.js';

export const EMBEDDING_METADATA_TABLE = 'embedding_index_metadata';
export const EMBEDDING_INDEX_NAME = 'sections';

export const EMBEDDING_METADATA_SQL = `
  CREATE TABLE IF NOT EXISTS ${EMBEDDING_METADATA_TABLE} (
    index_name TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    embedding_dim INTEGER NOT NULL,
    query_prefix TEXT NOT NULL,
    passage_prefix TEXT NOT NULL,
    prefix_policy_version TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    policy_signature TEXT NOT NULL,
    section_count INTEGER NOT NULL,
    vec_row_count INTEGER NOT NULL,
    last_built_scope TEXT NOT NULL DEFAULT 'all',
    last_built_spec_id TEXT,
    generated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export function buildEmbeddingPolicySignature() {
  return [
    MODEL_NAME,
    EMBEDDING_DIM,
    QUERY_PREFIX,
    PASSAGE_PREFIX,
    PREFIX_POLICY_VERSION,
    EMBEDDING_POLICY_VERSION,
  ].join('|');
}

export function getExpectedEmbeddingMetadata() {
  return {
    indexName: EMBEDDING_INDEX_NAME,
    modelName: MODEL_NAME,
    embeddingDim: EMBEDDING_DIM,
    queryPrefix: QUERY_PREFIX,
    passagePrefix: PASSAGE_PREFIX,
    prefixPolicyVersion: PREFIX_POLICY_VERSION,
    policyVersion: EMBEDDING_POLICY_VERSION,
    policySignature: buildEmbeddingPolicySignature(),
  };
}

export function ensureEmbeddingMetadataTable(db) {
  db.exec(EMBEDDING_METADATA_SQL);
}

export function hasEmbeddingMetadataTable(db) {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(EMBEDDING_METADATA_TABLE);

  return Boolean(row);
}

export function readEmbeddingMetadata(db) {
  ensureEmbeddingMetadataTable(db);

  return db.prepare(
    `SELECT *
     FROM ${EMBEDDING_METADATA_TABLE}
     WHERE index_name = ?`
  ).get(EMBEDDING_INDEX_NAME) ?? null;
}

export function clearEmbeddingMetadata(db) {
  ensureEmbeddingMetadataTable(db);
  db.prepare(
    `DELETE FROM ${EMBEDDING_METADATA_TABLE}
     WHERE index_name = ?`
  ).run(EMBEDDING_INDEX_NAME);
}

export function upsertEmbeddingMetadata(db, metadata) {
  ensureEmbeddingMetadataTable(db);

  db.prepare(
    `INSERT INTO ${EMBEDDING_METADATA_TABLE} (
      index_name,
      model_name,
      embedding_dim,
      query_prefix,
      passage_prefix,
      prefix_policy_version,
      policy_version,
      policy_signature,
      section_count,
      vec_row_count,
      last_built_scope,
      last_built_spec_id,
      generated_at
    ) VALUES (
      @indexName,
      @modelName,
      @embeddingDim,
      @queryPrefix,
      @passagePrefix,
      @prefixPolicyVersion,
      @policyVersion,
      @policySignature,
      @sectionCount,
      @vecRowCount,
      @lastBuiltScope,
      @lastBuiltSpecId,
      datetime('now')
    )
    ON CONFLICT(index_name) DO UPDATE SET
      model_name = excluded.model_name,
      embedding_dim = excluded.embedding_dim,
      query_prefix = excluded.query_prefix,
      passage_prefix = excluded.passage_prefix,
      prefix_policy_version = excluded.prefix_policy_version,
      policy_version = excluded.policy_version,
      policy_signature = excluded.policy_signature,
      section_count = excluded.section_count,
      vec_row_count = excluded.vec_row_count,
      last_built_scope = excluded.last_built_scope,
      last_built_spec_id = excluded.last_built_spec_id,
      generated_at = excluded.generated_at`
  ).run(metadata);
}

function countAllSections(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM sections').get().c;
}

function countAllVectors(db) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_sections'"
  ).get();
  if (!row) return 0;
  return db.prepare('SELECT COUNT(*) AS c FROM vec_sections').get().c;
}

export function getEmbeddingIndexStatus(db) {
  const expected = getExpectedEmbeddingMetadata();
  const metadataTableExists = hasEmbeddingMetadataTable(db);
  const metadata = metadataTableExists ? readEmbeddingMetadata(db) : null;
  const sectionCount = countAllSections(db);
  const vecRowCount = countAllVectors(db);

  const reasons = [];
  if (!vecRowCount) reasons.push('no_vectors');
  if (!metadata) reasons.push('missing_metadata');
  if (metadata && metadata.policy_signature !== expected.policySignature) {
    reasons.push('stale_policy');
  }
  if (metadata && metadata.section_count !== sectionCount) {
    reasons.push('section_count_mismatch');
  }
  if (metadata && metadata.vec_row_count !== vecRowCount) {
    reasons.push('metadata_vec_count_mismatch');
  }
  if (vecRowCount !== sectionCount) {
    reasons.push('incomplete_index');
  }

  return {
    available: reasons.length === 0,
    reasons,
    sectionCount,
    vecRowCount,
    metadata,
    expected,
  };
}
