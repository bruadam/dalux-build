'use strict';

const { ProjectTemplateSchema } = require('../projects');

/**
 * Mirrors models/project_templates/models.py::ProjectTemplate — identical
 * shape to projects/models.py::ProjectTemplate, so it's reused rather than
 * duplicated. listProjectTemplates returns raw/unmodeled data in Python too
 * (company-wide endpoint), so no response wrapper is defined here.
 */
module.exports = { ProjectTemplateSchema };
