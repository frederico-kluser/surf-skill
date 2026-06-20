// Bounded-concurrency worker pool. Zero dependencies. Partial-failure tolerant.
//
// Pattern: N workers drain a shared cursor over `items`. Each task is wrapped
// in try/catch so one failure never kills a worker (the zero-dep equivalent of
// p-limit + Promise.allSettled). Results are written back positionally, so the
// returned array lines up index-for-index with `items`.
//
// Each result is { ok: true, value } | { ok: false, error }.

export async function mapPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  if (list.length === 0) return results;

  // At least 1 worker, never more workers than items, hard cap for safety.
  const n = Math.max(1, Math.min(Math.floor(concurrency) || 1, list.length, 32));

  let cursor = 0;
  async function runWorker() {
    while (true) {
      const i = cursor++;
      if (i >= list.length) return;
      try {
        results[i] = { ok: true, value: await worker(list[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }

  const workers = [];
  for (let w = 0; w < n; w++) workers.push(runWorker());
  await Promise.all(workers);
  return results;
}
