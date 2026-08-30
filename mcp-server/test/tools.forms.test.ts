import type { DaluxClient } from 'dalux-build-api';
import * as forms from '../src/tools/forms';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/forms', () => {
  it('listForms unwraps the items envelope and paginates', async () => {
    const getProjectForms = jest.fn().mockResolvedValue({ items: [{ formId: 'f1' }, { formId: 'f2' }] });
    const client = fakeClient({ forms: { getProjectForms } });

    const result = await forms.listForms(client, { projectId: 'p1', limit: 1 });

    expect(getProjectForms).toHaveBeenCalledWith('p1');
    expect(result.items).toEqual([{ formId: 'f1' }]);
    expect(result.totalCount).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('getForm forwards to FormsApi.getForm', async () => {
    const getForm = jest.fn().mockResolvedValue({ formId: 'f1' });
    const client = fakeClient({ forms: { getForm } });

    const result = await forms.getForm(client, { projectId: 'p1', formId: 'f1' });

    expect(getForm).toHaveBeenCalledWith('p1', 'f1');
    expect(result).toEqual({ formId: 'f1' });
  });
});
