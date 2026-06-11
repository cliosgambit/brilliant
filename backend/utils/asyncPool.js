/**
 * Run async tasks with a fixed concurrency limit.
 * onProgress({ completed, total, index, item, error }) called after each task.
 */
async function runPool(items, fn, { concurrency = 4, shouldCancel = () => false, onProgress } = {}) {
  const list = items || [];
  const total = list.length;
  if (total === 0) return { results: [], succeeded: 0, failed: 0 };

  const results = new Array(total);
  let nextIndex = 0;
  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  async function worker() {
    while (true) {
      if (shouldCancel()) break;
      const i = nextIndex;
      if (i >= total) break;
      nextIndex += 1;

      const item = list[i];
      let error = null;
      try {
        results[i] = await fn(item, i);
        succeeded += 1;
      } catch (e) {
        error = e;
        results[i] = { error: e?.message || String(e) };
        failed += 1;
      }
      completed += 1;
      if (onProgress) {
        onProgress({ completed, total, index: i, item, error, succeeded, failed });
      }
    }
  }

  const workers = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  return { results, succeeded, failed, completed };
}

module.exports = { runPool };
