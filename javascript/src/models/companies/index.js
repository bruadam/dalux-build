'use strict';

const { ProjectCompanySchema } = require('../projects');
const { listResponseSchema, singleResponseSchema } = require('../helpers');

/** Mirrors models/companies/models.py, which re-exports ProjectCompany. */
const CompaniesListResponseSchema = listResponseSchema(ProjectCompanySchema);
const CompanyResponseSchema = singleResponseSchema(ProjectCompanySchema);

module.exports = {
  ProjectCompanySchema,
  CompaniesListResponseSchema,
  CompanyResponseSchema,
};
