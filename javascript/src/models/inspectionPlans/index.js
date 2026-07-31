'use strict';

const { z } = require('zod');
const { listResponseSchema } = require('../helpers');

/**
 * Mirrors models/inspection_plans/models.py::InspectionPlan — an empty
 * placeholder in Python, so list items stay untyped (unwrapped but
 * otherwise unvalidated).
 */
const InspectionPlanSchema = z.any();

const InspectionPlansListResponseSchema = listResponseSchema(InspectionPlanSchema);

module.exports = {
  InspectionPlanSchema,
  InspectionPlansListResponseSchema,
};
