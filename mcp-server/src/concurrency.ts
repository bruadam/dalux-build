/** Run `worker` over `items` with at most `limit` in flight, stopping when `shouldStop` says so. */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  shouldStop: () => boolean,
  worker: (item: T, index: number) => Promise<void>,
): Promise<number> {
  let next = 0;
  let processed = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (shouldStop()) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
      processed += 1;
    }
  });
  await Promise.all(runners);
  return processed;
}
