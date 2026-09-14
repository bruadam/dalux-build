import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { collectAllDaluxItems } from '../daluxPagination';
import { fullListForLlm, type PaginatedForLlm } from '../serialize';

// ---------- list_projects ----------

export const listProjectsInput = z.object({
  updatedAfter: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp; only return projects updated after this time.'),
});
export type ListProjectsInput = z.infer<typeof listProjectsInput>;

/** Retrieves all projects available to the authenticated client. */
export async function listProjects(
  client: DaluxClient,
  args: ListProjectsInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems((params) => client.projects.listProjects(params), args);
  return fullListForLlm(items);
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
