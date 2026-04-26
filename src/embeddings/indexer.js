import { serializeVector, validateVector } from './serializeVector.js';
import {
  embedBatch,
  getEmbeddingDim,
  getEmbeddingRuntimeInfo,
  initEmbedding,
  normalizeEmbeddingText,
} from './pipeline.js';
import {
  buildEmbeddingPolicySignature,
  clearEmbeddingMetadata,
  ensureEmbeddingMetadataTable,
  getExpectedEmbeddingMetadata,
  readEmbeddingMetadata,
  upsertEmbeddingMetadata,
} from './indexMetadata.js';

const DEFAULT_BATCH_SIZE = 16;
const MAX_PASSAGE_CHARS = 4000;

function buildWhereClause(spec) {
  if (!spec) {
    return {
      clause: '',
      params: [],
    };
  }

  return {
    clause: 'WHERE spec_id = ?',
    params: [spec],
  };
}

function countSections(db, spec = null) {
  const { clause, params } = buildWhereClause(spec);
  return db.prepare(`SELECT COUNT(*) AS c FROM sections ${clause}`).get(...params).c;
}

function listTargetSections(db, spec = null, limit = null) {
  const { clause, params } = buildWhereClause(spec);
  const sql = `
    SELECT id, spec_id, section_number, section_title, content
    FROM sections
    ${clause}
    ORDER BY spec_id, section_number
    ${Number.isFinite(limit) ? `LIMIT ${Number(limit)}` : ''}
  `;

  return db.prepare(sql).all(...params);
}

function listExistingVectorIds(db, spec = null) {
  const { clause, params } = buildWhereClause(spec);
  const sql = `
    SELECT v.section_id
    FROM vec_sections v
    JOIN sections s ON s.id = v.section_id
    ${clause}
  `;

  return new Set(
    db.prepare(sql).all(...params).map((row) => row.section_id)
  );
}

function deleteVectorsForScope(db, spec = null) {
  if (!spec) {
    db.prepare('DELETE FROM vec_sections').run();
    return;
  }

  db.prepare(
    `DELETE FROM vec_sections
     WHERE section_id IN (
       SELECT id FROM sections WHERE spec_id = ?
     )`
  ).run(spec);
}

export function buildSectionPassage(section) {
  const headerParts = [
    section.spec_id
      ?.replace(/^ts_/i, 'TS ')
      .replace(/^rfc_/i, 'RFC ')
      .replace(/_/g, '.'),
    section.section_number ? `Section ${section.section_number}` : null,
    normalizeEmbeddingText(section.section_title),
  ].filter(Boolean);

  const content = normalizeEmbeddingText(section.content);
  const combined = `${headerParts.join(' ')}\n${content}`.trim();
  return combined.slice(0, MAX_PASSAGE_CHARS);
}

export function createEmbeddingGenerator(options = {}) {
  const {
    embedTexts = null,
    embeddingDim = getEmbeddingDim(),
    runtimeInfo = getEmbeddingRuntimeInfo(),
  } = options;

  return async function generateEmbeddingsIndex(db, generationOptions = {}) {
    const {
      spec = null,
      batchSize = DEFAULT_BATCH_SIZE,
      rebuild = false,
      limit = null,
    } = generationOptions;

    ensureEmbeddingMetadataTable(db);

    const existingMetadata = readEmbeddingMetadata(db);
    const currentPolicySignature = buildEmbeddingPolicySignature();
    const policyMatches = !existingMetadata || existingMetadata.policy_signature === currentPolicySignature;
    const totalSectionCount = countSections(db);
    const targetSectionCount = countSections(db, spec);

    if (!policyMatches && spec) {
      throw new Error('Embedding policy changed; run a full rebuild without --spec before incremental updates');
    }

    if (!policyMatches && !rebuild) {
      throw new Error('Embedding policy changed; rerun with --rebuild to regenerate the vector index');
    }

    if (rebuild) {
      deleteVectorsForScope(db, spec);
      if (!spec) {
        clearEmbeddingMetadata(db);
      }
    }

    const sections = listTargetSections(db, spec, limit);
    const existingVectorIds = listExistingVectorIds(db, spec);
    const sectionsToGenerate = rebuild || !policyMatches
      ? sections
      : sections.filter((section) => !existingVectorIds.has(section.id));
    const insertedCount = sectionsToGenerate.filter((section) => !existingVectorIds.has(section.id)).length;
    const updatedCount = sectionsToGenerate.length - insertedCount;

    if (sectionsToGenerate.length > 0) {
      for (let i = 0; i < sectionsToGenerate.length; i += batchSize) {
        const batch = sectionsToGenerate.slice(i, i + batchSize);
        const passages = batch.map(buildSectionPassage);
        const vectors = embedTexts
          ? await embedTexts(passages, batch, { batchSize })
          : await embedBatch(passages, { kind: 'passage', batchSize });

        if (vectors.length !== batch.length) {
          throw new Error(`Embedding batch mismatch: expected ${batch.length}, got ${vectors.length}`);
        }

        const writeBatch = db.transaction((rows, embeddings) => {
          const deleteStmt = db.prepare('DELETE FROM vec_sections WHERE section_id = ?');
          const insertStmt = db.prepare(
            'INSERT INTO vec_sections(section_id, embedding) VALUES (?, ?)'
          );

          for (let j = 0; j < rows.length; j += 1) {
            const vector = embeddings[j];
            const sectionId = String(rows[j].id);

            if (!validateVector(vector, embeddingDim)) {
              throw new Error(`Invalid embedding dimensions for ${sectionId}`);
            }

            deleteStmt.run(sectionId);
            insertStmt.run(sectionId, serializeVector(vector));
          }
        });

        writeBatch(batch, vectors);
      }
    }

    const vecRowCount = db.prepare('SELECT COUNT(*) AS c FROM vec_sections').get().c;
    const expectedMetadata = getExpectedEmbeddingMetadata();
    upsertEmbeddingMetadata(db, {
      indexName: expectedMetadata.indexName,
      modelName: runtimeInfo.modelName,
      embeddingDim,
      queryPrefix: expectedMetadata.queryPrefix,
      passagePrefix: expectedMetadata.passagePrefix,
      prefixPolicyVersion: expectedMetadata.prefixPolicyVersion,
      policyVersion: expectedMetadata.policyVersion,
      policySignature: currentPolicySignature,
      sectionCount: totalSectionCount,
      vecRowCount,
      lastBuiltScope: spec ? 'spec' : 'all',
      lastBuiltSpecId: spec,
    });

    return {
      inserted: insertedCount,
      updated: updatedCount,
      skipped: sections.length - sectionsToGenerate.length,
      processed: sectionsToGenerate.length,
      selected: sections.length,
      targetSectionCount,
      totalSectionCount,
      vecRowCount,
      metadataFresh: vecRowCount === totalSectionCount,
      policySignature: currentPolicySignature,
      modelName: runtimeInfo.modelName,
      embeddingDim,
    };
  };
}

export async function ensureEmbeddingRuntimeReady() {
  const ready = await initEmbedding();
  if (!ready) {
    throw new Error('Embedding runtime is unavailable. Install @huggingface/transformers or @xenova/transformers.');
  }

  return getEmbeddingRuntimeInfo();
}
