import type { DaluxClient } from 'dalux-build-api';
import * as quality from '../src/tools/quality';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/quality', () => {
  it('listTestPlans returns all Dalux-paginated items', async () => {
    const listTestPlans = jest.fn().mockResolvedValue({ items: [{ testPlanId: 'tp1' }, { testPlanId: 'tp2' }] });
    const client = fakeClient({ testPlans: { listTestPlans } });

    const result = await quality.listTestPlans(client, { projectId: 'p1' });

    expect(listTestPlans).toHaveBeenCalledWith('p1', {}, true);
    expect(result.items).toHaveLength(2);
    expect(result.returnedCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('listTestPlanRegistrations returns all Dalux-paginated items', async () => {
    const registrations = [{ registrationId: 'r1' }];
    const listTestPlanRegistrations = jest.fn().mockResolvedValue({ items: registrations });
    const client = fakeClient({ testPlans: { listTestPlanRegistrations } });

    const result = await quality.listTestPlanRegistrations(client, { projectId: 'p1' });

    expect(listTestPlanRegistrations).toHaveBeenCalledWith('p1', {}, true);
    expect(result.items).toEqual(registrations);
    expect(result.truncated).toBe(false);
  });

  it('listInspectionPlans returns all Dalux-paginated items', async () => {
    const inspectionPlans = [{ inspectionPlanId: 'ip1' }];
    const listInspectionPlans = jest.fn().mockResolvedValue({ items: inspectionPlans });
    const client = fakeClient({ inspectionPlans: { listInspectionPlans } });

    const result = await quality.listInspectionPlans(client, { projectId: 'p1' });

    expect(listInspectionPlans).toHaveBeenCalledWith('p1', {}, true);
    expect(result.items).toEqual(inspectionPlans);
    expect(result.truncated).toBe(false);
  });
});
