import { getCitationSourcesBySectionIds } from '../citations/metadata.js';
import { formatCitation } from '../citations/formatters.js';
import { formatStructuredSuccess } from './helpers.js';

const citationStyles = ['3gpp', 'ieee', 'apa', 'plain'];

export const generateCitationSchema = {
  name: 'generate_citation',
  description: 'Generate formatted citations for one or more 3GPP document sections.',
  inputSchema: {
    type: 'object',
    properties: {
      section_ids: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 1,
        description: 'Section IDs to cite, e.g. ts_38_331:5.3.2',
      },
      style: { type: 'string', enum: citationStyles, description: 'Citation style (default: 3gpp)' },
    },
    required: ['section_ids'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      citations: { type: 'array', items: { type: 'object' } },
      sources: { type: 'array', items: { type: 'object' } },
      missing_section_ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['citations', 'sources', 'missing_section_ids'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};

export function buildCitationPayload(sectionIds, style = '3gpp') {
  const sources = getCitationSourcesBySectionIds(sectionIds);
  const byId = new Map(sources.map(source => [source.section_id, source]));
  const orderedSources = sectionIds.map(sectionId => byId.get(sectionId)).filter(Boolean);

  return {
    citations: orderedSources.map((source, index) => ({
      section_id: source.section_id,
      citation: formatCitation(source, style, index + 1),
      style,
      source_id: source.source_id,
    })),
    sources: orderedSources.map(source => ({
      source_id: source.source_id,
      section_id: source.section_id,
      spec_id: source.spec_id,
      section_number: source.section_number,
      section_title: source.section_title,
    })),
    missing_section_ids: sectionIds.filter(sectionId => !byId.has(sectionId)),
  };
}

export function handleGenerateCitation(args) {
  const { section_ids: sectionIds, style = '3gpp' } = args;
  return formatStructuredSuccess(buildCitationPayload(sectionIds, style));
}
