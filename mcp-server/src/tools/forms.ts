import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

const paginationFields = {
  limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 50, max 200).'),
  offset: z.number().int().min(0).optional().describe('Number of items to skip (for paging through results).'),
};

// ---------- list_forms ----------

export const listFormsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  ...paginationFields,
});
export type ListFormsInput = z.infer<typeof listFormsInput>;

export async function listForms(
  client: DaluxClient,
  args: ListFormsInput,
): Promise<PaginatedForLlm<unknown>> {
  const response = await client.forms.getProjectForms(args.projectId);
  return paginateForLlm(response?.items ?? [], args);
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
