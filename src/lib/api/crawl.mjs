// Library wrapper for `crawl` (Tavily only).

import { dispatch } from '../dispatch.mjs';
import { buildInMemoryState } from '../../env.mjs';
import { setSilent } from '../progress.mjs';

/**
 * Recursive site crawl. Tavily-only.
 *
 * @param {string} url - root URL
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=1]
 * @param {number} [opts.maxBreadth=20]
 * @param {number} [opts.limit=50]
 * @param {string} [opts.instructions]
 * @param {string|string[]} [opts.selectPaths]
 * @param {string|string[]} [opts.excludePaths]
 * @param {string} [opts.tavilyKey]
 * @returns {Promise<object>} normalized envelope
 */
export async function crawl(url, opts = {}) {
  if (opts.quiet !== false) setSilent(true);
  if (!url || typeof url !== 'string') throw new Error('crawl: url required');

  const state = await buildInMemoryState(opts);
  return dispatch(
    'crawl',
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
      images: opts.images,
      categories: opts.categories,
      extractDepth: opts.extractDepth || 'basic',
      format: opts.format || 'markdown',
      query: opts.query,
      chunks: opts.chunks,
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
