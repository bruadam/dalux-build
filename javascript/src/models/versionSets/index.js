'use strict';

const { z } = require('zod');
const { listResponseSchema, singleResponseSchema } = require('../helpers');

/** Mirrors models/version_sets/models.py::VersionSet. */
const VersionSetSchema = z.object({
  versionSetId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  fileAreaId: z.string(),
});

const VersionSetsListResponseSchema = listResponseSchema(VersionSetSchema);
const VersionSetResponseSchema = singleResponseSchema(VersionSetSchema);

module.exports = {
  VersionSetSchema,
  VersionSetsListResponseSchema,
  VersionSetResponseSchema,
};
