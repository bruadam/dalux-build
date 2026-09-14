import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

// ---------- list_project_users ----------

export const listProjectUsersInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListProjectUsersInput = z.infer<typeof listProjectUsersInput>;

export async function listProjectUsers(
  client: DaluxClient,
  args: ListProjectUsersInput,
): Promise<PaginatedForLlm<unknown>> {
  const response = await client.users.listProjectUsers(args.projectId);
  return paginateForLlm(response?.items ?? []);
}

// ---------- get_user ----------

export const getUserInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  userId: z.string().describe('The user ID.'),
});
export type GetUserInput = z.infer<typeof getUserInput>;

export async function getUser(client: DaluxClient, args: GetUserInput) {
  return client.users.getProjectUser(args.projectId, args.userId);
}

// ---------- list_project_companies ----------

export const listProjectCompaniesInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListProjectCompaniesInput = z.infer<typeof listProjectCompaniesInput>;

export async function listProjectCompanies(
  client: DaluxClient,
  args: ListProjectCompaniesInput,
): Promise<PaginatedForLlm<unknown>> {
  const response = await client.companies.listProjectCompanies(args.projectId);
  return paginateForLlm(response?.items ?? []);
}
