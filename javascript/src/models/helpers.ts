import { z } from 'zod';
import { LinkSchema, MetadataSchema } from './common';

/**
 * Unwraps a `{ data: {...} }` wrapper before validating against `schema`.
 * Bare objects (no `data` wrapper) pass straight through.
 * Mirrors the `unwrap_and_convert_items` field_validator repeated across
 * every Python `responses.py` file.
 */
export function unwrapData<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
      return (value as { data: unknown }).data;
    }
    return value;
  }, schema);
}

/**
 * Builds a `{ items, metadata?, links? }` list-response schema.
 * Accepts a bare array payload too (wraps it as `{ items: [...] }`) —
 * mirrors TaskChanges' `wrap_list_payloads` model_validator.
 */
export function listResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.preprocess(
    (value) => (Array.isArray(value) ? { items: value } : value),
    z.object({
      items: z.array(unwrapData(itemSchema)).default([]),
      metadata: MetadataSchema.optional(),
      links: z.array(LinkSchema).optional(),
    }),
  );
}

/**
 * Builds a `{ data, links? }` single-item response schema.
 */
export function singleResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: itemSchema,
    links: z.array(LinkSchema).optional(),
  });
}

/**
 * A defaulted field that also accepts an explicit JSON `null` (treated the
 * same as an absent field) — mirrors Pydantic's `Optional[T] = default`,
 * which accepts both a missing key and an explicit `null`. Plain
 * `schema.default(x)` alone only fires on `undefined`, not `null`.
 */
export function nullableDefault<T extends z.ZodTypeAny>(schema: T, defaultValue: z.input<T>) {
  return z.preprocess(
    (v) => (v === null ? undefined : v),
    schema.default(defaultValue as never),
  );
}
