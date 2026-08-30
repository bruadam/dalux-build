import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

const paginationFields = {
  limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 50, max 200).'),
  offset: z.number().int().min(0).optional().describe('Number of items to skip (for paging through results).'),
};

// ---------- list_work_packages ----------

export const listWorkPackagesInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  ...paginationFields,
});
export type ListWorkPackagesInput = z.infer<typeof listWorkPackagesInput>;

export async function listWorkPackages(
  client: DaluxClient,
  args: ListWorkPackagesInput,
): Promise<PaginatedForLlm<unknown>> {
  const response = await client.workPackages.listWorkPackages(args.projectId);
  return paginateForLlm(response?.items ?? [], args);
}

// ---------- list_version_sets ----------

export const listVersionSetsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  ...paginationFields,
});
export type ListVersionSetsInput = z.infer<typeof listVersionSetsInput>;

export async function listVersionSets(
  client: DaluxClient,
  args: ListVersionSetsInput,
): Promise<PaginatedForLlm<unknown>> {
  const response = await client.versionSets.getVersionSets(args.projectId);
  return paginateForLlm(response?.items ?? [], args);
}
