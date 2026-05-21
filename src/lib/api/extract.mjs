// Library wrapper for `extract`.

import { dispatch } from '../dispatch.mjs';
import { buildInMemoryState } from '../../env.mjs';
import { setSilent } from '../progress.mjs';

/**
 * Extract clean content from URLs.
 *
 * @param {string|string[]} urls - one or more URLs (max 20)
 * @param {object} [opts]
 * @param {string|string[]} [opts.tavilyKey|opts.tavilyKeys]
 * @param {string|string[]} [opts.parallelKey|opts.parallelKeys]
 * @param {'tavily'|'parallel'} [opts.provider]
 * @param {'basic'|'advanced'} [opts.depth='basic']
 * @param {string} [opts.query] - focus extraction on this topic
 * @param {boolean} [opts.quiet=true]
 * @returns {Promise<object>} normalized envelope
 */
export async function extract(urls, opts = {}) {
  if (opts.quiet !== false) setSilent(true);
  const urlList = Array.isArray(urls) ? urls : [urls];
  if (!urlList.length) throw new Error('extract: at least 1 URL required');
  if (urlList.length > 20) throw new Error('extract: max 20 URLs per call');

  const state = await buildInMemoryState(opts);
  return dispatch(
    'extract',
    {
      urls: urlList,
      depth: opts.depth || 'basic',
      format: opts.format || 'markdown',
      query: opts.query,
      chunks: opts.chunks,
      images: opts.images,
      extractTimeout: opts.extractTimeout,
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
