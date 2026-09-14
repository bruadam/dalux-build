import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

// ---------- list_work_packages ----------

export const listWorkPackagesInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListWorkPackagesInput = z.infer<typeof listWorkPackagesInput>;

export async function listWorkPackages(
  client: DaluxClient,
  args: ListWorkPackagesInput,
): Promise<PaginatedForLlm<unknown>> {
  const response = await client.workPackages.listWorkPackages(args.projectId);
  return paginateForLlm(response?.items ?? []);
}

// ---------- list_version_sets ----------

export const listVersionSetsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListVersionSetsInput = z.infer<typeof listVersionSetsInput>;

export async function listVersionSets(
  client: DaluxClient,
  args: ListVersionSetsInput,
): Promise<PaginatedForLlm<unknown>> {
  const response = await client.versionSets.getVersionSets(args.projectId);
  return paginateForLlm(response?.items ?? []);
}
