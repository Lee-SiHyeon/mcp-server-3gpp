export function parseSpecId(specId) {
  if (typeof specId !== 'string') {
    return { doc_type: '3GPP', doc_number: '' };
  }

  const match = specId.match(/^(ts|tr)_(\d+)_(\d+)(?:_(\d+))?$/i);
  if (!match) {
    return { doc_type: '3GPP', doc_number: specId };
  }

  const [, type, series, number, part] = match;
  return {
    doc_type: type.toUpperCase(),
    doc_number: part ? `${series}.${number}-${part}` : `${series}.${number}`,
  };
}
