'use strict';

const { z } = require('zod');
const { listResponseSchema, singleResponseSchema } = require('../helpers');

/** Mirrors models/file_areas/models.py::FileArea (all fields required). */
const FileAreaSchema = z.object({
  fileAreaId: z.string(),
  fileAreaName: z.string(),
  fileAreaType: z.string(),
});

const FileAreasListResponseSchema = listResponseSchema(FileAreaSchema);
const FileAreaResponseSchema = singleResponseSchema(FileAreaSchema);

module.exports = {
  FileAreaSchema,
  FileAreasListResponseSchema,
  FileAreaResponseSchema,
};
