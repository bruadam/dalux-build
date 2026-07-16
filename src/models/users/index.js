'use strict';

const { z } = require('zod');
const { listResponseSchema, singleResponseSchema } = require('../helpers');

/** Mirrors models/users/models.py::User. */
const UserSchema = z.object({
  userId: z.string(),
  userType: z.string(),
  email: z.string().email(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
});

/** Mirrors models/users/models.py::ProjectUser (User + companyId). */
const ProjectUserSchema = UserSchema.extend({
  companyId: z.string().nullish(),
});

const UsersListResponseSchema = listResponseSchema(ProjectUserSchema);
/** Single-user response wraps User, not ProjectUser — matches Python. */
const UserResponseSchema = singleResponseSchema(UserSchema);

module.exports = {
  UserSchema,
  ProjectUserSchema,
  UsersListResponseSchema,
  UserResponseSchema,
};
