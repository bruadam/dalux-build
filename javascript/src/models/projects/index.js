'use strict';

const { z } = require('zod');
const { listResponseSchema, singleResponseSchema } = require('../helpers');

/** Mirrors models/projects/models.py::ProjectModule (empty placeholder, passthrough). */
const ProjectModuleSchema = z.object({}).passthrough();

/** Mirrors models/projects/models.py::Project. Note: `type` is the real JSON key (Python aliases project_type -> "type"). */
const ProjectSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  type: z.string().nullish(),
  projectTemplateId: z.string().nullish(),
  address: z.string().nullish(),
  number: z.string().nullish(),
  created: z.string().nullish(),
  closing: z.string().nullish(),
  modules: z.array(ProjectModuleSchema).nullish(),
});

/** Mirrors models/projects/models.py::ProjectMetadata. */
const ProjectMetadataSchema = z.object({
  key: z.string(),
  value: z.string().nullish(),
});

/** Mirrors models/projects/models.py::ProjectTemplate (also duplicated in project_templates/models.py — same shape). */
const ProjectTemplateSchema = z.object({
  projectTemplateId: z.string(),
  name: z.string(),
});

/** Mirrors models/projects/models.py::ProjectCompany. */
const ProjectCompanySchema = z.object({
  companyId: z.string().nullish(),
  name: z.string().nullish(),
  vatNumber: z.string().nullish(),
  address: z.string().nullish(),
  city: z.string().nullish(),
  postalCode: z.string().nullish(),
  country: z.string().nullish(),
  catalogCompanyId: z.string().nullish(),
});

const ProjectsListResponseSchema = listResponseSchema(ProjectSchema);
const ProjectResponseSchema = singleResponseSchema(ProjectSchema);

module.exports = {
  ProjectModuleSchema,
  ProjectSchema,
  ProjectMetadataSchema,
  ProjectTemplateSchema,
  ProjectCompanySchema,
  ProjectsListResponseSchema,
  ProjectResponseSchema,
};
