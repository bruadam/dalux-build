import { z } from 'zod';
import { ValidationError } from '../utils/errors';
import { unwrapData } from './helpers';

/**
 * Validate and convert a raw API response into a typed model, throwing a
 * ValidationError if the response doesn't match `schema`. Mirrors
 * response_converter.py::convert_to_model, without its legacy-compat
 * fallback branches (the JS test suite ships schema-valid fixtures).
 */
export function convertToModel<T extends z.ZodTypeAny>(
  response: unknown,
  schema: T,
  schemaName = 'model',
): z.infer<T> | null {
  if (response === null || response === undefined) return null;
  try {
    return schema.parse(response);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ValidationError(`Failed to convert response to ${schemaName}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Validate and convert a list of raw items into typed models.
 * Used by get_all_* pagination methods, which convert each item after
 * pagination has already collected the raw list.
 */
export function convertToModelList<T extends z.ZodTypeAny>(
  items: unknown,
  itemSchema: T,
  schemaName = 'model',
): z.infer<T>[] {
  if (!Array.isArray(items)) return [];
  const wrapped = unwrapData(itemSchema);
  return items.map((item) => convertToModel(item, wrapped, schemaName)) as z.infer<T>[];
}
