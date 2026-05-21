// Library wrapper for `map` (URL discovery; Tavily only).

import { dispatch } from '../dispatch.mjs';
import { buildInMemoryState } from '../../env.mjs';
import { setSilent } from '../progress.mjs';

/**
 * Discover URLs on a site without fetching content. Tavily-only.
 *
 * @param {string} url - root URL
 * @param {object} [opts]
 * @returns {Promise<object>} normalized envelope with { base_url, urls[] }
 */
export async function map(url, opts = {}) {
  if (opts.quiet !== false) setSilent(true);
  if (!url || typeof url !== 'string') throw new Error('map: url required');

  const state = await buildInMemoryState(opts);
  return dispatch(
    'map',
    {
      url,
      maxDepth: opts.maxDepth,
      maxBreadth: opts.maxBreadth,
      limit: opts.limit,
      instructions: opts.instructions,
      selectPaths: opts.selectPaths,
      selectDomains: opts.selectDomains,
      excludePaths: opts.excludePaths,
      excludeDomains: opts.excludeDomains,
      allowExternal: opts.allowExternal,
      categories: opts.categories,
      timeout: opts.timeout,
    },
    {
      provider: opts.provider,
      'no-fallback': opts.noFallback,
      'no-cache': opts.noCache,
      'confirm-expensive': true,
    },
    { state }
  );
}
