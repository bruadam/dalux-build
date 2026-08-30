import { paginateForLlm } from '../src/serialize';

describe('paginateForLlm', () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ id: i }));

  it('defaults to a page of 50', () => {
    const page = paginateForLlm(items);
    expect(page.items).toHaveLength(50);
    expect(page.totalCount).toBe(120);
    expect(page.returnedCount).toBe(50);
    expect(page.truncated).toBe(true);
  });

  it('respects limit and offset', () => {
    const page = paginateForLlm(items, { limit: 10, offset: 100 });
    expect(page.items).toHaveLength(10);
    expect(page.items[0]).toEqual({ id: 100 });
    expect(page.truncated).toBe(true);
  });

  it('reports truncated: false when the page reaches the end', () => {
    const page = paginateForLlm(items, { limit: 50, offset: 100 });
    expect(page.items).toHaveLength(20);
    expect(page.truncated).toBe(false);
  });

  it('caps limit at 200', () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const page = paginateForLlm(big, { limit: 1000 });
    expect(page.items).toHaveLength(200);
  });

  it('handles an empty list', () => {
    const page = paginateForLlm([]);
    expect(page.items).toEqual([]);
    expect(page.totalCount).toBe(0);
    expect(page.truncated).toBe(false);
  });
});
