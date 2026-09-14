import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { fullListForLlm, type PaginatedForLlm } from '../serialize';

// ---------- list_test_plans ----------

export const listTestPlansInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListTestPlansInput = z.infer<typeof listTestPlansInput>;

export async function listTestPlans(
  client: DaluxClient,
  args: ListTestPlansInput,
): Promise<PaginatedForLlm<unknown>> {
  const testPlans = await client.testPlans.getAllTestPlans(args.projectId);
  return fullListForLlm(testPlans);
}

// ---------- list_test_plan_registrations ----------

export const listTestPlanRegistrationsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListTestPlanRegistrationsInput = z.infer<typeof listTestPlanRegistrationsInput>;

export async function listTestPlanRegistrations(
  client: DaluxClient,
  args: ListTestPlanRegistrationsInput,
): Promise<PaginatedForLlm<unknown>> {
  const registrations = await client.testPlans.getAllTestPlanRegistrations(args.projectId);
  return fullListForLlm(registrations);
}

// ---------- list_inspection_plans ----------

export const listInspectionPlansInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListInspectionPlansInput = z.infer<typeof listInspectionPlansInput>;

export async function listInspectionPlans(
  client: DaluxClient,
  args: ListInspectionPlansInput,
): Promise<PaginatedForLlm<unknown>> {
  const inspectionPlans = await client.inspectionPlans.getAllInspectionPlans(args.projectId);
  return fullListForLlm(inspectionPlans);
}
