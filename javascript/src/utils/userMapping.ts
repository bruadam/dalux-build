import { z } from 'zod';
import { ProjectUserSchema } from '../models/users';
import { ProjectCompanySchema } from '../models/companies';

type ProjectUser = z.infer<typeof ProjectUserSchema>;
type ProjectCompany = z.infer<typeof ProjectCompanySchema>;

/**
 * Builds a `userId` → `ProjectUser` lookup. Mirrors
 * `python/dalux_build/utils/user_mapping.py::create_user_mapping`.
 */
export function createUserMapping(users: readonly ProjectUser[]): Map<string, ProjectUser> {
  const mapping = new Map<string, ProjectUser>();
  for (const user of users) mapping.set(user.userId, user);
  return mapping;
}

/**
 * Builds a `companyId` → `ProjectCompany` lookup, skipping entries with no
 * `companyId`. Mirrors
 * `python/dalux_build/utils/user_mapping.py::create_company_mapping`.
 */
export function createCompanyMapping(companies: readonly ProjectCompany[]): Map<string, ProjectCompany> {
  const mapping = new Map<string, ProjectCompany>();
  for (const company of companies) {
    if (company.companyId) mapping.set(company.companyId, company);
  }
  return mapping;
}

/**
 * Recursively walks `response` and, on every object that looks like a user
 * (has both `userId` and `companyId`), adds a `company` field alongside
 * `companyId` from `companyMapping`. Leaves everything else untouched,
 * including a `companyId` with no match in `companyMapping`.
 *
 * Mirrors `user_mapping.py::enrich_users_with_companies`. Used to nest a
 * company under a user that {@link enrichResponseWithUsers} already added
 * (e.g. a file's `uploadedByUser`), so a second enrichment pass can reach
 * into a result the first one produced.
 */
export function enrichUsersWithCompanies(
  response: unknown,
  companyMapping: ReadonlyMap<string, ProjectCompany>,
): unknown {
  if (Array.isArray(response)) {
    return response.map((item) => enrichUsersWithCompanies(item, companyMapping));
  }
  if (response !== null && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    const result: Record<string, unknown> = { ...record };
    if ('userId' in record && 'companyId' in record) {
      const companyId = record.companyId;
      if (typeof companyId === 'string' && companyMapping.has(companyId)) {
        result.company = companyMapping.get(companyId);
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (value !== null && typeof value === 'object') {
        result[key] = enrichUsersWithCompanies(value, companyMapping);
      }
    }
    return result;
  }
  return response;
}

/**
 * Recursively walks `response` and, for every field named in
 * `fieldMappings` whose value is a string id present in `mapping`, adds the
 * resolved object alongside it under the mapped field name — keeping the
 * original id field. Works at any depth, through nested objects and arrays.
 *
 * Mirrors `user_mapping.py::enrich_response_with_users`. `mapping`'s values
 * are plain objects here (already-parsed Zod output), unlike the Python
 * version's Pydantic models, so there is no `model_dump` step.
 *
 * @param fieldMappings e.g. `{ uploadedByUserId: 'uploadedByUser' }` — adds
 *   `uploadedByUser` next to `uploadedByUserId` when the id resolves.
 */
export function enrichResponseWithUsers(
  response: unknown,
  mapping: ReadonlyMap<string, unknown>,
  fieldMappings: Readonly<Record<string, string>>,
): unknown {
  if (Array.isArray(response)) {
    return response.map((item) => enrichResponseWithUsers(item, mapping, fieldMappings));
  }
  if (response !== null && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    const result: Record<string, unknown> = { ...record };
    for (const [key, value] of Object.entries(record)) {
      if (key in fieldMappings && typeof value === 'string' && mapping.has(value)) {
        result[fieldMappings[key]] = mapping.get(value);
      } else if (value !== null && typeof value === 'object') {
        result[key] = enrichResponseWithUsers(value, mapping, fieldMappings);
      }
    }
    return result;
  }
  return response;
}
