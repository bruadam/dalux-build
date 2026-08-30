import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

const paginationFields = {
  limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 50, max 200).'),
  offset: z.number().int().min(0).optional().describe('Number of items to skip (for paging through results).'),
};

// ---------- list_projects ----------

export const listProjectsInput = z.object({
  updatedAfter: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp; only return projects updated after this time.'),
  ...paginationFields,
});
export type ListProjectsInput = z.infer<typeof listProjectsInput>;

/** Retrieves all projects available to the authenticated client. */
export async function listProjects(
  client: DaluxClient,
  args: ListProjectsInput,
): Promise<PaginatedForLlm<unknown>> {
  const { limit, offset, ...params } = args;
  const response = await client.projects.listProjects(params);
  return paginateForLlm(response?.items ?? [], args);
}

// ---------- get_project ----------

export const getProjectInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type GetProjectInput = z.infer<typeof getProjectInput>;

/** Retrieves a specific project. */
export async function getProject(client: DaluxClient, args: GetProjectInput) {
  return client.projects.getProject(args.projectId);
}

// ---------- find_project_by_name ----------

export const findProjectByNameInput = z.object({
  projectName: z.string().describe('The exact project name to search for.'),
});
export type FindProjectByNameInput = z.infer<typeof findProjectByNameInput>;

/**
 * Looks up a project's ID by its exact name. Returns null if no project
 * with that name is found.
 */
export async function findProjectByName(client: DaluxClient, args: FindProjectByNameInput) {
  return client.projects.getProjectByName(args.projectName);
}
