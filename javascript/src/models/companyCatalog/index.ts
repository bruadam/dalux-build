import { z } from 'zod';
import { listResponseSchema, singleResponseSchema } from '../helpers';

/**
 * Mirrors models/company_catalog/responses.py. These are exported for name
 * parity but, like their Python counterparts, are NOT what the API layer
 * actually uses — company_catalog.py's get_companies/get_company return
 * CompaniesListResponse/CompanyResponse (typed ProjectCompany) instead.
 * See src/api/CompanyCatalogApi.js.
 */
export const CompanyCatalogListResponseSchema = listResponseSchema(z.any());
export const CompanyCatalogResponseSchema = singleResponseSchema(z.any());
