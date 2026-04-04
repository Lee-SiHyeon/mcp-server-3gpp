import { hybridSearch } from '../search/hybridRanker.js';

// EMM cause codes from TS 24.301 Table 9.9.3.9.1
const EMM_CAUSES = {
  2: 'IMSI unknown in HSS',
  3: 'Illegal UE',
  5: 'IMEI not accepted',
  6: 'Illegal ME',
  7: 'EPS services not allowed',
  8: 'EPS services and non-EPS services not allowed',
  9: 'UE identity cannot be derived by the network',
  10: 'Implicitly detached',
  11: 'PLMN not allowed',
  12: 'Tracking Area not allowed',
  13: 'Roaming not allowed in this tracking area',
  14: 'EPS services not allowed in this PLMN',
  15: 'No Suitable Cells In tracking area',
  16: 'MSC temporarily not reachable',
  17: 'Network failure',
  18: 'CS domain not available',
  19: 'ESM failure',
  20: 'MAC failure',
  21: 'Synch failure',
  22: 'Congestion',
  23: 'UE security capabilities mismatch',
  24: 'Security mode rejected, unspecified',
  25: 'Not authorized for this CSG',
  26: 'Non-EPS authentication unacceptable',
  35: 'Requested service option not authorized in this PLMN',
  39: 'CS service temporarily not available',
  40: 'No EPS bearer context activated',
  42: 'Severe network failure',
  95: 'Semantically incorrect message',
  96: 'Invalid mandatory information',
  97: 'Message type non-existent or not implemented',
  98: 'Message type not compatible with the protocol state',
  99: 'Information element non-existent or not implemented',
  100: 'Conditional IE error',
  101: 'Message not compatible with the protocol state',
  111: 'Protocol error, unspecified',
};

export const getEmmCauseSchema = {
  name: 'get_emm_cause',
  description: 'Look up the meaning of an EMM (EPS Mobility Management) cause code from 3GPP TS 24.301. Returns the cause name, description, and references to related specification sections.',
  inputSchema: {
    type: 'object',
    properties: {
      causeNumber: { type: 'number', description: 'Numeric EMM cause code (e.g., 11)' },
    },
    required: ['causeNumber'],
  },
};

export function handleGetEmmCause(args) {
  const { causeNumber } = args;
  const causeName = EMM_CAUSES[causeNumber];

  if (!causeName) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Unknown EMM cause: ${causeNumber}`,
          valid_causes: Object.entries(EMM_CAUSES).map(([k, v]) => `${k}: ${v}`),
        }, null, 2),
      }],
    };
  }

  // Search for related sections
  const searchResult = hybridSearch(`EMM cause ${causeNumber} ${causeName}`, {
    spec: 'ts_24_301',
    maxResults: 3,
  });

  const result = {
    causeNumber,
    causeName,
    description: `EMM cause #${causeNumber}: ${causeName}`,
    sourceSpec: 'ts_24_301',
    relatedSections: searchResult.results.map(r => ({
      section_id: r.section_id,
      spec_id: r.spec_id,
      section_number: r.section_number,
      title: r.title,
    })),
  };

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
