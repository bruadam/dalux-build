import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

// ---------- list_forms ----------

export const listFormsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListFormsInput = z.infer<typeof listFormsInput>;

export async function listForms(
  client: DaluxClient,
  args: ListFormsInput,
): Promise<PaginatedForLlm<unknown>> {
  const response = await client.forms.getProjectForms(args.projectId);
  return paginateForLlm(response?.items ?? []);
}

// ---------- get_form ----------

export const getFormInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  formId: z.string().describe('The form ID.'),
});
export type GetFormInput = z.infer<typeof getFormInput>;

export async function getForm(client: DaluxClient, args: GetFormInput) {
  return client.forms.getForm(args.projectId, args.formId);
}
