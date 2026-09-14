import type { DaluxClient } from 'dalux-build-api';
import * as quality from '../src/tools/quality';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/quality', () => {
  it('listTestPlans returns all Dalux-paginated items', async () => {
    const testPlans = Array.from({ length: 3 }, (_, i) => ({ testPlanId: `tp${i}` }));
    const getAllTestPlans = jest.fn().mockResolvedValue(testPlans);
    const client = fakeClient({ testPlans: { getAllTestPlans } });

    const result = await quality.listTestPlans(client, { projectId: 'p1' });

    expect(getAllTestPlans).toHaveBeenCalledWith('p1');
    expect(result.items).toHaveLength(3);
    expect(result.returnedCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('listTestPlanRegistrations returns all Dalux-paginated items', async () => {
    const registrations = [{ registrationId: 'r1' }];
    const getAllTestPlanRegistrations = jest.fn().mockResolvedValue(registrations);
    const client = fakeClient({ testPlans: { getAllTestPlanRegistrations } });

    const result = await quality.listTestPlanRegistrations(client, { projectId: 'p1' });

    expect(getAllTestPlanRegistrations).toHaveBeenCalledWith('p1');
    expect(result.items).toEqual(registrations);
    expect(result.truncated).toBe(false);
  });

  it('listInspectionPlans returns all Dalux-paginated items', async () => {
    const inspectionPlans = [{ inspectionPlanId: 'ip1' }];
    const getAllInspectionPlans = jest.fn().mockResolvedValue(inspectionPlans);
    const client = fakeClient({ inspectionPlans: { getAllInspectionPlans } });

    const result = await quality.listInspectionPlans(client, { projectId: 'p1' });

    expect(getAllInspectionPlans).toHaveBeenCalledWith('p1');
    expect(result.items).toEqual(inspectionPlans);
    expect(result.truncated).toBe(false);
  });
});
