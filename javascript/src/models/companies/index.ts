import { ProjectCompanySchema } from '../projects';
import { listResponseSchema, singleResponseSchema } from '../helpers';

/** Mirrors models/companies/models.py, which re-exports ProjectCompany. */
export { ProjectCompanySchema };
export const CompaniesListResponseSchema = listResponseSchema(ProjectCompanySchema);
export const CompanyResponseSchema = singleResponseSchema(ProjectCompanySchema);
