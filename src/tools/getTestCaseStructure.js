import { getConnection } from '../db/connection.js';
import { formatSuccess, formatError, resolveSectionId } from './helpers.js';

const SUBSECTION_LABELS = [
  'Test Purpose(?:\\s*\\(TP\\))?',
  'Conformance requirements?',
  'Test description',
  'Pre-test conditions',
  'Initial conditions',
  'Test procedure(?: sequence)?',
  'Specific message contents?',
  'Expected behaviour',
  'Expected behavior',
  'Expected results?',
  'Main behaviour',
  'Main behavior',
];

const SUBSECTION_RE = new RegExp(
  `(^|\\n)(\\d+[A-Za-z]?(?:\\.\\d+[A-Za-z]?)+)[\\t ]+(${SUBSECTION_LABELS.join('|')})[\\t ]*(?=\\n|$)`,
  'gi',
);

export const getTestCaseStructureSchema = {
  name: 'get_test_case_structure',
  description: 'Extract structured test case data from a 3GPP conformance test specification section. Parses Test Purpose clauses, conformance references, pre-test conditions, procedure tables, and message contents.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionId: { type: 'string', description: "Full section ID (e.g. 'ts_38_523_1:6.1.1.1')" },
      specId: { type: 'string', description: 'Spec ID (use with sectionNumber)' },
      sectionNumber: { type: 'string', description: 'Section number (use with specId)' },
      includeRawContent: { type: 'boolean', description: 'Include original text for each subsection (default: false)' },
    },
  },
};

function normalizeWhitespace(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function snippet(text, maxChars = 500) {
  const normalized = normalizeWhitespace(text);
  return normalized.length > maxChars ? `${normalized.substring(0, maxChars - 3)}...` : normalized;
}

function stripHeader(text, subSection, titlePattern) {
  const headerRe = new RegExp(`^\\s*${subSection.replace(/\./g, '\\.')}\\s+${titlePattern}\\s*`, 'i');
  return text.replace(headerRe, '').trim();
}

function extractSubsections(content) {
  const matches = [...content.matchAll(SUBSECTION_RE)];
  return matches.map((match, index) => {
    const start = match.index + match[1].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : content.length;
    return {
      subSection: match[2],
      title: match[3].trim(),
      text: content.slice(start, end).trim(),
    };
  });
}

function findSubsection(subsections, titlePattern) {
  return subsections.find(subsection => titlePattern.test(subsection.title));
}

function findClause(text, clause) {
  const re = new RegExp(`${clause}\\s*\\{([\\s\\S]*?)\\}`, 'i');
  const match = text.match(re);
  return match ? normalizeWhitespace(match[1]) : undefined;
}

function parsePurposeBlock(id, text) {
  const result = { id };
  const withText = findClause(text, 'with');
  const whenText = findClause(text, 'when');
  const thenText = findClause(text, 'then');

  if (withText) result.with = withText;
  result.ensure_that = /ensure\s+that\s*\{/i.test(text);
  if (whenText) result.when = whenText;
  if (thenText) result.then = thenText;

  return result;
}

function parseTestPurpose(subsection, includeRawContent) {
  if (!subsection) return undefined;

  const body = stripHeader(subsection.text, subsection.subSection, 'Test Purpose(?:\\s*\\(TP\\))?');
  const blockRe = /^\s*\((\d+)\)\s*/gm;
  const matches = [...body.matchAll(blockRe)];
  let purposes = [];

  if (matches.length > 0) {
    purposes = matches.map((match, index) => {
      const start = match.index + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index : body.length;
      return parsePurposeBlock(Number(match[1]), body.slice(start, end));
    });
  } else if (body.trim()) {
    purposes = [parsePurposeBlock(1, body)];
  }

  return {
    sub_section: subsection.subSection,
    purposes,
    ...(includeRawContent ? { raw_content: body } : {}),
  };
}

function parseReferences(text) {
  const normalized = normalizeWhitespace(text);
  const refs = normalized.match(/\b(?:TS|TR)\s+\d{2}\.\d{3}\s+clauses?\s+[^.;]+/gi) || [];
  return refs.map(ref => ref.replace(/\s+/g, ' ').trim());
}

function parseConformanceRequirements(subsection, includeRawContent) {
  if (!subsection) return undefined;
  const body = stripHeader(subsection.text, subsection.subSection, 'Conformance requirements?');
  return {
    sub_section: subsection.subSection,
    references: parseReferences(body),
    text_snippet: snippet(body),
    ...(includeRawContent ? { raw_content: body } : {}),
  };
}

function parseTextSubsection(subsection, includeRawContent) {
  if (!subsection) return undefined;
  const body = stripHeader(subsection.text, subsection.subSection, subsection.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return {
    sub_section: subsection.subSection,
    text_snippet: snippet(body),
    ...(includeRawContent ? { raw_content: body } : {}),
  };
}

function parseTestProcedure(subsection, includeRawContent) {
  if (!subsection) return undefined;
  const body = stripHeader(subsection.text, subsection.subSection, 'Test procedure(?: sequence)?');
  const tables = [...body.matchAll(/\bTable\s+(\d+(?:\.\d+)*(?:-\d+)?)/gi)]
    .map(match => `Table ${match[1]}`);

  return {
    sub_section: subsection.subSection,
    tables: [...new Set(tables)],
    has_main_behaviour: /\bMain behaviou?r\b/i.test(body) || /\bExpected (?:behaviou?r|results?)\b/i.test(body),
    text_snippet: snippet(body),
    ...(includeRawContent ? { raw_content: body } : {}),
  };
}

function parseSpecificMessageContents(subsection, includeRawContent) {
  if (!subsection) return undefined;
  const body = stripHeader(subsection.text, subsection.subSection, 'Specific message contents?');
  return {
    sub_section: subsection.subSection,
    is_none: /^\s*None\s*$/i.test(body),
    ...(/^\s*None\s*$/i.test(body) ? {} : { text_snippet: snippet(body) }),
    ...(includeRawContent ? { raw_content: body } : {}),
  };
}

function parseStructure(content, includeRawContent) {
  const subsections = extractSubsections(content);
  const testPurpose = findSubsection(subsections, /^Test Purpose/i);
  const conformanceRequirements = findSubsection(subsections, /^Conformance requirements?$/i);
  const preTestConditions = findSubsection(subsections, /^(?:Pre-test|Initial) conditions$/i);
  const testProcedure = findSubsection(subsections, /^Test procedure(?: sequence)?$/i);
  const specificMessageContents = findSubsection(subsections, /^Specific message contents?$/i);

  return {
    test_purpose: parseTestPurpose(testPurpose, includeRawContent),
    conformance_requirements: parseConformanceRequirements(conformanceRequirements, includeRawContent),
    pre_test_conditions: parseTextSubsection(preTestConditions, includeRawContent),
    test_procedure_sequence: parseTestProcedure(testProcedure, includeRawContent),
    specific_message_contents: parseSpecificMessageContents(specificMessageContents, includeRawContent),
  };
}

export function handleGetTestCaseStructure(args) {
  try {
    const db = getConnection();
    const sectionId = resolveSectionId(args);
    const includeRawContent = args.includeRawContent || false;

    if (!sectionId) {
      return formatError('Provide sectionId or both specId and sectionNumber');
    }

    const section = db.prepare(`
      SELECT id, spec_id, section_number, section_title, content
      FROM sections
      WHERE id = ?
    `).get(sectionId);

    if (!section) {
      return formatError(`Section not found: ${sectionId}`);
    }

    if (!/\bTest Purpose(?:\s*\(TP\))?\b/i.test(section.content) && !/\bTest description\b/i.test(section.content)) {
      return formatError({
        error: `Section does not appear to be a structured test case: ${sectionId}`,
        reason: 'No Test Purpose or Test description marker was found in the section content.',
      });
    }

    return formatSuccess({
      section_id: section.id,
      spec_id: section.spec_id,
      section_number: section.section_number,
      section_title: section.section_title,
      structure: parseStructure(section.content, includeRawContent),
    });
  } catch (error) {
    console.error('[get_test_case_structure] Error:', error.message, { args });
    return formatError({
      error: error.message,
      tool: 'get_test_case_structure',
      context: { args },
    });
  }
}
