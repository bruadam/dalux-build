'use strict';

const { z } = require('zod');
const { LinkSchema, MetadataSchema } = require('./common');

/**
 * Unwraps a `{ data: {...} }` wrapper before validating against `schema`.
 * Bare objects (no `data` wrapper) pass straight through.
 * Mirrors the `unwrap_and_convert_items` field_validator repeated across
 * every Python `responses.py` file.
 * @param {import('zod').ZodTypeAny} schema
 */
function unwrapData(schema) {
  return z.preprocess((value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
      return value.data;
    }
    return value;
  }, schema);
}

/**
 * Builds a `{ items, metadata?, links? }` list-response schema.
 * Accepts a bare array payload too (wraps it as `{ items: [...] }`) —
 * mirrors TaskChanges' `wrap_list_payloads` model_validator.
 * @param {import('zod').ZodTypeAny} itemSchema
 */
function listResponseSchema(itemSchema) {
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
 * @param {import('zod').ZodTypeAny} itemSchema
 */
function singleResponseSchema(itemSchema) {
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
 * @param {import('zod').ZodTypeAny} schema
 * @param {*} defaultValue
 */
function nullableDefault(schema, defaultValue) {
  return z.preprocess((v) => (v === null ? undefined : v), schema.default(defaultValue));
}

module.exports = { unwrapData, listResponseSchema, singleResponseSchema, nullableDefault };
