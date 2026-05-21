// Library wrappers for research (sync + async start/poll).

import { dispatch } from '../dispatch.mjs';
import { buildInMemoryState } from '../../env.mjs';
import { setSilent } from '../progress.mjs';
import { providerFromRequestId } from '../providers/index.mjs';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));

/**
 * Start an async deep research job. Returns immediately with a request_id.
 * Use researchPoll(id) to check status / get result.
 *
 * @param {string} input - the research question
 * @param {object} [opts]
 * @param {'mini'|'auto'|'pro'|'ultra'} [opts.model='auto']
 * @returns {Promise<object>} envelope with data.request_id, data.status
 */
export async function researchStart(input, opts = {}) {
  if (opts.quiet !== false) setSilent(true);
  if (!input || typeof input !== 'string') throw new Error('researchStart: input required');

  const state = await buildInMemoryState(opts);
  return dispatch(
    'research-start',
    {
      input,
      model: opts.model || 'auto',
      citationFormat: opts.citationFormat || 'numbered',
      outputSchema: opts.outputSchema,
      processor: opts.processor,
    },
    {
      provider: opts.provider,
      'no-fallback': opts.noFallback,
      'confirm-expensive': true,
    },
    { state }
  );
}

/**
 * Poll a research job by request_id. The id encodes the originating provider
 * (e.g. 'tvly:abc' or 'pllx:abc'), so no provider hint is needed.
 *
 * @param {string} requestId
 * @returns {Promise<object>} envelope with data.status + data.content when completed
 */
export async function researchPoll(requestId, opts = {}) {
  if (opts.quiet !== false) setSilent(true);
  if (!requestId || typeof requestId !== 'string') throw new Error('researchPoll: requestId required');

  const decoded = providerFromRequestId(requestId);
  if (!decoded) throw new Error(`unknown request_id prefix in '${requestId}'`);

  const state = await buildInMemoryState(opts);
  return dispatch(
    'research-poll',
    {},
    { ...opts, __requestId: requestId, 'confirm-expensive': true },
    { state }
  );
}

/**
 * Synchronous research wrapper. Refuses model=pro/ultra (those are too slow).
 * Polls every 5s up to 50s; if not finished, returns the in-progress envelope
 * with request_id so caller can poll later.
 */
export async function research(input, opts = {}) {
  if (opts.quiet !== false) setSilent(true);
  const model = opts.model || 'mini';
  if (model === 'pro' || model === 'ultra') {
    throw new Error(`research: model=${model} too slow for sync. Use researchStart + researchPoll.`);
  }

  const start = await researchStart(input, { ...opts, model });
  const requestId = start.data.request_id;
  const deadline = Date.now() + (opts.timeoutMs || 50_000);

  while (Date.now() < deadline) {
    await SLEEP(5000);
    const poll = await researchPoll(requestId, opts);
    if (poll.data.status === 'completed' || poll.data.status === 'failed') {
      return poll;
    }
  }
  return {
    operation: 'research',
    data: {
      request_id: requestId,
      status: 'pending',
      hint: `Use researchPoll('${requestId}') to continue.`,
    },
  };
}
