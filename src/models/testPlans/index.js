'use strict';

const { z } = require('zod');
const { listResponseSchema } = require('../helpers');

/**
 * Mirrors models/test_plans/models.py::TestPlan — empty placeholder in
 * Python, so list items stay untyped.
 */
const TestPlanSchema = z.any();

const TestPlansListResponseSchema = listResponseSchema(TestPlanSchema);

module.exports = {
  TestPlanSchema,
  TestPlansListResponseSchema,
};
