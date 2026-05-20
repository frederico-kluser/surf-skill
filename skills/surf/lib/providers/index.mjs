// Provider registry: capability map + factory.

import { tavilyProvider } from './tavily.mjs';
import { parallelProvider } from './parallel.mjs';

export const PROVIDERS = {
  tavily: tavilyProvider,
  parallel: parallelProvider,
};

// Default fallback chain per operation. Adjust with care: order matters.
export const capabilityMap = {
  search:           ['tavily', 'parallel'],
  extract:          ['tavily', 'parallel'],
  crawl:            ['tavily'],
  map:              ['tavily'],
  'research-start': ['parallel', 'tavily'],
  research:         ['parallel', 'tavily'],
  'research-poll':  ['BY_REQUEST_ID'],
  usage:            ['BY_PROVIDER'],
};

export function getProvider(name) {
  return PROVIDERS[name];
}

export function providerFromRequestId(requestId) {
  if (typeof requestId !== 'string') return null;
  if (requestId.startsWith('tvly:')) return { provider: 'tavily', providerRunId: requestId.slice(5) };
  if (requestId.startsWith('pllx:')) return { provider: 'parallel', providerRunId: requestId.slice(5) };
  return null;
}
