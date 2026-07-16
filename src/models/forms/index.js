'use strict';

const { z } = require('zod');
const { listResponseSchema, singleResponseSchema } = require('../helpers');

/**
 * Mirrors models/forms/models.py::Form — empty placeholder in Python, so
 * items stay untyped.
 */
const FormSchema = z.any();

const FormsListResponseSchema = listResponseSchema(FormSchema);
const FormResponseSchema = singleResponseSchema(FormSchema);

module.exports = {
  FormSchema,
  FormsListResponseSchema,
  FormResponseSchema,
};
