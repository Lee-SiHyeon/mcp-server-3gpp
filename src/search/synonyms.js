/**
 * 3GPP domain synonym table for query expansion.
 * Each entry maps a canonical term to its aliases (and vice-versa).
 * Used during query parsing to expand searches.
 */

const SYNONYM_GROUPS = [
  ['UE', 'user equipment', 'terminal', 'mobile station', 'MS'],
  ['gNB', 'gNodeB', 'g-NodeB', 'next generation node B'],
  ['eNB', 'eNodeB', 'e-NodeB', 'evolved node B', 'base station'],
  ['ng-eNB', 'next generation eNB'],
  ['AMF', 'access and mobility management function'],
  ['SMF', 'session management function'],
  ['UPF', 'user plane function'],
  ['PCF', 'policy control function'],
  ['AUSF', 'authentication server function'],
  ['UDM', 'unified data management'],
  ['NRF', 'network repository function'],
  ['NSSF', 'network slice selection function'],
  ['NR', 'new radio', '5G NR'],
  ['LTE', 'long term evolution', '4G LTE', 'E-UTRA'],
  ['5G', 'fifth generation', 'NR', 'new radio'],
  ['4G', 'fourth generation', 'LTE'],
  ['RRC', 'radio resource control'],
  ['PDCP', 'packet data convergence protocol'],
  ['RLC', 'radio link control'],
  ['MAC', 'medium access control'],
  ['PHY', 'physical layer'],
  ['handover', 'handoff', 'HO'],
  ['attach', 'registration', 'initial registration'],
  ['detach', 'deregistration'],
  ['paging', 'paging procedure'],
  ['bearer', 'data bearer', 'radio bearer', 'DRB'],
  ['SRB', 'signaling radio bearer'],
  ['DRB', 'data radio bearer'],
  ['PDSCH', 'physical downlink shared channel'],
  ['PUSCH', 'physical uplink shared channel'],
  ['PDCCH', 'physical downlink control channel'],
  ['PUCCH', 'physical uplink control channel'],
  ['PBCH', 'physical broadcast channel'],
  ['PRACH', 'physical random access channel'],
  ['RSRP', 'reference signal received power'],
  ['RSRQ', 'reference signal received quality'],
  ['SINR', 'signal to interference noise ratio'],
  ['RSSI', 'received signal strength indicator'],
  ['HARQ', 'hybrid automatic repeat request', 'hybrid ARQ'],
  ['ARQ', 'automatic repeat request'],
  ['QoS', 'quality of service'],
  ['QoE', 'quality of experience'],
  ['SON', 'self organizing network'],
  ['MDT', 'minimization of drive tests'],
  ['SON', 'self-organizing network'],
  ['MBB', 'mobile broadband'],
  ['eMBB', 'enhanced mobile broadband'],
  ['URLLC', 'ultra reliable low latency communication'],
  ['mMTC', 'massive machine type communication'],
  ['IoT', 'internet of things'],
  ['NB-IoT', 'narrowband IoT', 'narrowband internet of things'],
  ['V2X', 'vehicle to everything'],
  ['D2D', 'device to device'],
  ['ProSe', 'proximity services'],
  ['IMS', 'IP multimedia subsystem'],
  ['VoLTE', 'voice over LTE'],
  ['VoNR', 'voice over NR', 'voice over new radio'],
  ['SLA', 'service level agreement'],
  ['slice', 'network slice', 'network slicing'],
  ['NSSAI', 'network slice selection assistance information'],
  ['S-NSSAI', 'single network slice selection assistance information'],
];

const synonymMap = new Map();

for (const group of SYNONYM_GROUPS) {
  const normalized = group.map(t => t.toLowerCase().trim());
  for (const term of normalized) {
    const others = normalized.filter(t => t !== term);
    if (!synonymMap.has(term)) synonymMap.set(term, new Set());
    for (const o of others) synonymMap.get(term).add(o);
  }
}

/**
 * Expand a query term to include its synonyms.
 * Returns the original term plus up to 3 synonyms (most specific first).
 */
export function expandWithSynonyms(term) {
  const key = term.toLowerCase().trim();
  const syns = synonymMap.get(key);
  if (!syns || syns.size === 0) return [term];
  return [term, ...[...syns].slice(0, 3)];
}

/**
 * Expand all tokens in a query string.
 * Detects single-token terms and multi-word phrases.
 * Returns an array of alternative query strings.
 */
export function expandQuerySynonyms(queryText) {
  if (!queryText || queryText.trim().length === 0) return [queryText];

  const lower = queryText.toLowerCase().trim();
  const expansions = new Set([queryText]);

  for (const [term, syns] of synonymMap) {
    if (lower.includes(term)) {
      for (const syn of [...syns].slice(0, 2)) {
        const expanded = lower.replace(new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi'), syn);
        if (expanded !== lower) expansions.add(expanded);
      }
    }
  }

  return [...expansions].slice(0, 4);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
