import type { CapabilityCatalog } from '../../shared/api';

// An explicit empty runtime prevents a nullish fallback to a previously cached
// catalog. A pending request changes availability without editing the draft.
export const UNAVAILABLE_CATALOG: CapabilityCatalog = {
  source: 'omnimux', models: [], text: [], image: [], video: [], audio: [],
};
