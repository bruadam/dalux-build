import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { collectAllDaluxItems } from '../daluxPagination';
import { pageInput, paginateForLlm, type PaginatedForLlm } from '../serialize';

// ---------- list_test_plans ----------

export const listTestPlansInput = z.object({
  projectId: z.string(),
  ...pageInput,
});
export type ListTestPlansInput = z.infer<typeof listTestPlansInput>;

export async function listTestPlans(
  client: DaluxClient,
  args: ListTestPlansInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems(async (params) => {
    const response = await client.testPlans.listTestPlans(args.projectId, params, true);
    return Array.isArray(response) ? { items: response } : response;
  });
  return paginateForLlm(items, args);
}

// ---------- list_test_plan_registrations ----------

export const listTestPlanRegistrationsInput = z.object({
  projectId: z.string(),
  ...pageInput,
});
export type ListTestPlanRegistrationsInput = z.infer<typeof listTestPlanRegistrationsInput>;

export async function listTestPlanRegistrations(
  client: DaluxClient,
  args: ListTestPlanRegistrationsInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems(async (params) => {
    const response = await client.testPlans.listTestPlanRegistrations(args.projectId, params, true);
    return Array.isArray(response) ? { items: response } : response;
  });
  return paginateForLlm(items, args);
}

// ---------- list_inspection_plans ----------

export const listInspectionPlansInput = z.object({
  projectId: z.string(),
  ...pageInput,
});
export type ListInspectionPlansInput = z.infer<typeof listInspectionPlansInput>;

export async function listInspectionPlans(
  client: DaluxClient,
  args: ListInspectionPlansInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems(async (params) => {
    const response = await client.inspectionPlans.listInspectionPlans(args.projectId, params, true);
    return Array.isArray(response) ? { items: response } : response;
  });
  return paginateForLlm(items, args);
}
