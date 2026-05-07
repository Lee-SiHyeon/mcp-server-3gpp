const STYLE_SET = new Set(['3gpp', 'ieee', 'apa', 'plain']);

function citationStyle(style) {
  return STYLE_SET.has(style) ? style : '3gpp';
}

function docLabel(source) {
  return `3GPP ${source.doc_type || '3GPP'} ${source.doc_number || source.spec_id || ''}`.trim();
}

function versionWithV(version) {
  return version ? String(version) : '';
}

function bareVersion(version) {
  return version ? String(version).replace(/^v/i, '') : '';
}

function sectionPhrase(sectionNumber, label = 'Section') {
  return sectionNumber ? `${label} ${sectionNumber}` : '';
}

export function formatCitation(source, style = '3gpp', index = 1) {
  const selectedStyle = citationStyle(style);
  const doc = docLabel(source);
  const title = source.section_title || '';
  const section = source.section_number || '';
  const version = source.spec_version || source.version || '';

  if (selectedStyle === 'ieee') {
    const parts = [`[${index}] 3GPP`];
    if (title) parts.push(`, "${title},"`);
    parts.push(` ${doc}`);
    if (section) parts.push(`, sec. ${section}`);
    if (version) parts.push(`, version ${bareVersion(version)}`);
    return `${parts.join('')}.`;
  }

  if (selectedStyle === 'apa') {
    const details = [doc];
    if (section) details.push(sectionPhrase(section));
    if (version) details.push(`Version ${bareVersion(version)}`);
    const citedTitle = title || doc;
    return `3rd Generation Partnership Project. (n.d.). ${citedTitle} (${details.join(', ')}).`;
  }

  if (selectedStyle === 'plain') {
    const first = version ? `${doc} ${versionWithV(version)}` : doc;
    return [first, sectionPhrase(section), title].filter(Boolean).join(' - ');
  }

  const parts = [doc];
  if (version) parts[0] = `${parts[0]} ${versionWithV(version)}`;
  if (section) parts.push(sectionPhrase(section));
  if (title) parts.push(`"${title}"`);
  return parts.join(', ');
}
