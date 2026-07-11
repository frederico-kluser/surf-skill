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

// Keyless / free providers — used ONLY by the standalone `surf-free-skill`, NOT
// by surf-research-skill. They require NO API key, are marked `keyless: true` on
// their adapter, and are deliberately NOT in state.mjs PROVIDERS nor in any
// capabilityMap chain — so they never appear in keys.json, `keys list`, setup,
// or key validation, and never mix into research's paid provider fallback.
// Dispatch reaches them only via the dedicated `flags.keyless` path, where they
// run with an undefined ctx.key.
export const KEYLESS_PROVIDERS = new Set(['wikipedia', 'ddg']);

export function isKeyless(name) {
  return KEYLESS_PROVIDERS.has(name);
}

// Default fallback chain per operation. Adjust with care: order matters.
// Brave is search-only (no extract/crawl/map/research equivalents). It joins
// the search chain as the 3rd option — Tavily/Parallel keep their precedence
// to preserve hot-path behavior for existing users.
// NOTE: keyless providers (wikipedia, ddg — see KEYLESS_PROVIDERS) are
// deliberately NOT in any chain here. surf-research-skill stays keyed-only, so
// `search` requires a key. The keyless providers are reached only via the
// dedicated `flags.keyless` dispatch path used by the standalone surf-free-skill.
export const capabilityMap = {
  search:           ['tavily', 'parallel', 'brave'],
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
