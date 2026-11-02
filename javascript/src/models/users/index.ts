import { z } from 'zod';
import { listResponseSchema, singleResponseSchema } from '../helpers';
import { ProjectCompanySchema } from '../projects';

/** Mirrors models/users/models.py::User. */
export const UserSchema = z.object({
  userId: z.string(),
  userType: z.string(),
  email: z.string().email(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
});

/**
 * Mirrors models/users/models.py::ProjectUser (User + companyId + company).
 * `company` is absent from every raw Dalux response, same as
 * `uploadedByUser` on `File` — it's populated locally by
 * `enrichUsersWithCompanies` (`userMapping.ts`) from a project's companies,
 * resolved against `companyId`.
 */
export const ProjectUserSchema = UserSchema.extend({
  companyId: z.string().nullish(),
  company: ProjectCompanySchema.nullish(),
});

export const UsersListResponseSchema = listResponseSchema(ProjectUserSchema);
/** Single-user response wraps User, not ProjectUser — matches Python. */
export const UserResponseSchema = singleResponseSchema(UserSchema);
