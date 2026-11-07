import assert from "node:assert/strict";
import { test } from "node:test";
import { collectAll, nextBookmark } from "../src/lib/pagination";

const link = (bookmark: string) => [{ rel: "nextPage", href: `https://x.dalux.com/api?bookmark=${bookmark}` }];

test("nextBookmark reads the bookmark of the nextPage link", () => {
  assert.equal(nextBookmark(link("abc")), "abc");
  assert.equal(nextBookmark([{ rel: "self", href: "https://x" }]), undefined);
});

test("collectAll follows bookmarks until there is no next page", async () => {
  const pages: Record<string, { items: number[]; links?: ReturnType<typeof link> }> = {
    "": { items: [1, 2], links: link("p2") },
    p2: { items: [3], links: link("p3") },
    p3: { items: [4] },
  };
  const seen: unknown[] = [];
  const items = await collectAll(async (params) => {
    seen.push(params.bookmark);
    return pages[(params.bookmark as string) ?? ""];
  });
  assert.deepEqual(items, [1, 2, 3, 4]);
  assert.deepEqual(seen, [undefined, "p2", "p3"]);
});

test("collectAll stops on a repeated bookmark", async () => {
  const items = await collectAll(async () => ({ items: [1], links: link("same") }));
  assert.deepEqual(items, [1, 1]);
});

test("collectAll retries rate limits", async () => {
  let calls = 0;
  const items = await collectAll(
    async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("slow down"), { name: "RateLimitError" });
      return { items: [1] };
    },
    { sleep: async () => undefined },
  );
  assert.deepEqual(items, [1]);
  assert.equal(calls, 2);
});
