import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

const paginationFields = {
  limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 50, max 200).'),
  offset: z.number().int().min(0).optional().describe('Number of items to skip (for paging through results).'),
};

// ---------- list_test_plans ----------

export const listTestPlansInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  ...paginationFields,
});
export type ListTestPlansInput = z.infer<typeof listTestPlansInput>;

export async function listTestPlans(
  client: DaluxClient,
  args: ListTestPlansInput,
): Promise<PaginatedForLlm<unknown>> {
  const testPlans = await client.testPlans.getAllTestPlans(args.projectId);
  return paginateForLlm(testPlans, args);
}

// ---------- list_test_plan_registrations ----------

export const listTestPlanRegistrationsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  ...paginationFields,
});
export type ListTestPlanRegistrationsInput = z.infer<typeof listTestPlanRegistrationsInput>;

export async function listTestPlanRegistrations(
  client: DaluxClient,
  args: ListTestPlanRegistrationsInput,
): Promise<PaginatedForLlm<unknown>> {
  const registrations = await client.testPlans.getAllTestPlanRegistrations(args.projectId);
  return paginateForLlm(registrations, args);
}

// ---------- list_inspection_plans ----------

export const listInspectionPlansInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  ...paginationFields,
});
export type ListInspectionPlansInput = z.infer<typeof listInspectionPlansInput>;

export async function listInspectionPlans(
  client: DaluxClient,
  args: ListInspectionPlansInput,
): Promise<PaginatedForLlm<unknown>> {
  const inspectionPlans = await client.inspectionPlans.getAllInspectionPlans(args.projectId);
  return paginateForLlm(inspectionPlans, args);
}
