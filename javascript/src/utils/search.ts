function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}

type Accessor<T> = (item: T) => Record<string, unknown> | null | undefined;

const identityAccessor = <T>(x: T) => x as unknown as Record<string, unknown>;

/**
 * Find the first item in an iterable where a field equals a value.
 * Supports camelCase and snake_case field-name matching.
 */
export function findByField<T>(
  items: readonly T[],
  field: string,
  value: unknown,
  accessor?: Accessor<T>,
): T | null {
  const get = accessor || identityAccessor<T>;
  for (const item of items) {
    const itemData = get(item);
    if (itemData && typeof itemData === 'object') {
      if (itemData[field] === value) return item;
      const camel = snakeToCamel(field);
      if (camel !== field && itemData[camel] === value) return item;
      const snake = camelToSnake(field);
      if (snake !== field && itemData[snake] === value) return item;
    }
  }
  return null;
}

/**
 * Find all items in an iterable where a field equals a value.
 */
export function findAllByField<T>(
  items: readonly T[],
  field: string,
  value: unknown,
  accessor?: Accessor<T>,
): T[] {
  const get = accessor || identityAccessor<T>;
  return items.filter((item) => {
    const itemData = get(item);
    if (!itemData || typeof itemData !== 'object') return false;
    if (itemData[field] === value) return true;
    const camel = snakeToCamel(field);
    if (camel !== field && itemData[camel] === value) return true;
    const snake = camelToSnake(field);
    if (snake !== field && itemData[snake] === value) return true;
    return false;
  });
}
