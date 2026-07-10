// Provider registry: capability map + factory.

import { tavilyProvider } from './tavily.mjs';
import { parallelProvider } from './parallel.mjs';
import { braveProvider } from './brave.mjs';
import { wikipediaProvider } from './wikipedia.mjs';
import { ddgProvider } from './ddg.mjs';

export const PROVIDERS = {
  tavily: tavilyProvider,
  parallel: parallelProvider,
  brave: braveProvider,
  wikipedia: wikipediaProvider,
  ddg: ddgProvider,
};

// Keyless / free providers. These require NO API key and are marked
// `keyless: true` on their adapter. They are deliberately NOT listed in
// state.mjs PROVIDERS, so they never appear in keys.json, `keys list`, the setup
// wizard, or key validation — there is nothing to manage. Dispatch special-cases
// them: they always survive the "has a usable key" chain filter and run with an
// undefined ctx.key. They exist so `search` ALWAYS delivers something, even with
// zero keys configured.
export const KEYLESS_PROVIDERS = new Set(['wikipedia', 'ddg']);

export function isKeyless(name) {
  return KEYLESS_PROVIDERS.has(name);
}

// Default fallback chain per operation. Adjust with care: order matters.
// Brave is search-only (no extract/crawl/map/research equivalents). It joins
// the search chain as the 3rd option — Tavily/Parallel keep their precedence
// to preserve hot-path behavior for existing users.
// wikipedia + ddg are the KEYLESS last-resort tier (see KEYLESS_PROVIDERS):
// wikipedia gives broad encyclopedic full-text results, ddg is the ultra-stable
// instant-answer safety net. Both are free and need no API key.
export const capabilityMap = {
  search:           ['tavily', 'parallel', 'brave', 'wikipedia', 'ddg'],
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
