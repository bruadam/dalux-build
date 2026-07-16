'use strict';

const { z } = require('zod');
const { ValidationError } = require('../utils/errors');
const { unwrapData } = require('./helpers');

/**
 * Validate and convert a raw API response into a typed model, throwing a
 * ValidationError if the response doesn't match `schema`. Mirrors
 * response_converter.py::convert_to_model, without its legacy-compat
 * fallback branches (the JS test suite ships schema-valid fixtures).
 * @param {*} response
 * @param {import('zod').ZodTypeAny} schema
 * @param {string} [schemaName]
 * @returns {*}
 */
function convertToModel(response, schema, schemaName = 'model') {
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
 * @param {Array} items
 * @param {import('zod').ZodTypeAny} itemSchema
 * @param {string} [schemaName]
 * @returns {Array}
 */
function convertToModelList(items, itemSchema, schemaName = 'model') {
  if (!Array.isArray(items)) return [];
  const wrapped = unwrapData(itemSchema);
  return items.map((item) => convertToModel(item, wrapped, schemaName));
}

module.exports = { convertToModel, convertToModelList };
