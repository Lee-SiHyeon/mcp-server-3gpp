import { getConnection } from '../db/connection.js';

export const getSpecReferencesSchema = {
  name: 'get_spec_references',
  description: `Retrieve cross-spec reference relationships for a given spec.
Returns:
  - outgoing: specs that THIS spec references (cites)
  - incoming: specs that reference THIS spec (cited-by)
Use to navigate the dependency graph between 3GPP specs and RFCs.`,
  inputSchema: {
    type: 'object',
    properties: {
      specId: {
        type: 'string',
        description: 'Canonical spec ID (e.g. ts_24_301, rfc_3261)',
      },
      direction: {
        type: 'string',
        enum: ['outgoing', 'incoming', 'both'],
        description: 'Which direction of references to return (default: both)',
      },
      inCorpusOnly: {
        type: 'boolean',
        description: 'Only return referenced specs that exist in the corpus (default: false)',
      },
      maxResults: {
        type: 'number',
        description: 'Max results per direction (default: 20)',
      },
    },
    required: ['specId'],
  },
};

export function handleGetSpecReferences(args) {
  const db = getConnection();
  const {
    specId,
    direction = 'both',
    inCorpusOnly = false,
    maxResults = 20,
  } = args;

  // Verify the spec exists
  const spec = db.prepare('SELECT id, title FROM specs WHERE id = ?').get(specId);
  if (!spec) {
    // Suggest similar IDs
    const suggestions = db.prepare(
      "SELECT id FROM specs WHERE id LIKE ? LIMIT 5"
    ).all(`%${specId.replace(/_/g, '%')}%`).map(r => r.id);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Spec not found: ${specId}`,
          suggestions,
        }),
      }],
    };
  }

  const corpusFilter = inCorpusOnly ? 'AND in_corpus = 1' : '';

  const result = { spec_id: spec.id, title: spec.title };

  // ── Outgoing: specs that specId cites ──────────────────────────────────────
  if (direction === 'outgoing' || direction === 'both') {
    const rows = db.prepare(`
      SELECT
        sr.target_spec_id,
        s.title                                  AS target_title,
        sr.in_corpus,
        COUNT(*)                                 AS mention_count,
        GROUP_CONCAT(DISTINCT sr.ref_type)       AS ref_types
      FROM spec_references sr
      LEFT JOIN specs s ON s.id = sr.target_spec_id
      WHERE sr.source_spec_id = ?
        ${corpusFilter}
      GROUP BY sr.target_spec_id
      ORDER BY mention_count DESC
      LIMIT ?
    `).all(specId, maxResults);

    result.outgoing = {
      description: 'Specs that this spec references (cites)',
      count: rows.length,
      refs: rows.map(r => ({
        spec_id: r.target_spec_id,
        title: r.target_title || null,
        in_corpus: r.in_corpus === 1,
        mention_count: r.mention_count,
        ref_types: r.ref_types,
      })),
    };
  }

  // ── Incoming: specs that cite specId ───────────────────────────────────────
  if (direction === 'incoming' || direction === 'both') {
    const rows = db.prepare(`
      SELECT
        sr.source_spec_id,
        s.title                                  AS source_title,
        1                                        AS in_corpus,
        COUNT(*)                                 AS mention_count,
        GROUP_CONCAT(DISTINCT sr.ref_type)       AS ref_types
      FROM spec_references sr
      LEFT JOIN specs s ON s.id = sr.source_spec_id
      WHERE sr.target_spec_id = ?
      GROUP BY sr.source_spec_id
      ORDER BY mention_count DESC
      LIMIT ?
    `).all(specId, maxResults);

    result.incoming = {
      description: 'Specs that reference this spec (cited-by)',
      count: rows.length,
      refs: rows.map(r => ({
        spec_id: r.source_spec_id,
        title: r.source_title || null,
        in_corpus: true,
        mention_count: r.mention_count,
        ref_types: r.ref_types,
      })),
    };
  }

  // ── Section-level outgoing (where exactly is it cited?) ───────────────────
  // Only if single direction and few enough results
  if (direction === 'outgoing' && result.outgoing?.refs?.length === 1) {
    const target = result.outgoing.refs[0].spec_id;
    const sections = db.prepare(`
      SELECT section_id, citation_text
      FROM spec_references
      WHERE source_spec_id = ? AND target_spec_id = ?
      LIMIT 10
    `).all(specId, target);
    result.outgoing.refs[0].cited_in_sections = sections;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
