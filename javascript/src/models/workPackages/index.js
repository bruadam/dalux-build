'use strict';

const { z } = require('zod');
const { listResponseSchema } = require('../helpers');

/** Mirrors models/work_packages/models.py::WorkPackage (extra="allow" -> passthrough). */
const WorkPackageSchema = z.object({
  workpackageId: z.string().nullish(),
  companyId: z.string().nullish(),
  name: z.string().nullish(),
}).passthrough();

/** No single-item response class in Python. */
const WorkPackagesListResponseSchema = listResponseSchema(WorkPackageSchema);

module.exports = {
  WorkPackageSchema,
  WorkPackagesListResponseSchema,
};
