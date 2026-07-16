'use strict';

const { z } = require('zod');
const { listResponseSchema, singleResponseSchema } = require('../helpers');

/**
 * Mirrors models/company_catalog/responses.py. These are exported for name
 * parity but, like their Python counterparts, are NOT what the API layer
 * actually uses — company_catalog.py's get_companies/get_company return
 * CompaniesListResponse/CompanyResponse (typed ProjectCompany) instead.
 * See src/api/CompanyCatalogApi.js.
 */
const CompanyCatalogListResponseSchema = listResponseSchema(z.any());
const CompanyCatalogResponseSchema = singleResponseSchema(z.any());

module.exports = {
  CompanyCatalogListResponseSchema,
  CompanyCatalogResponseSchema,
};
