import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { convertToModel, convertToModelList } from '../models/convert';
import { paginate } from '../utils/pagination';
import {
  TestPlanSchema,
  TestPlanItemSchema,
  TestPlanItemZoneSchema,
  TestPlanRegistrationSchema,
  TestPlansListResponseSchema,
  TestPlanItemsListResponseSchema,
  TestPlanItemZonesListResponseSchema,
  TestPlanRegistrationsListResponseSchema,
} from '../models/testPlans';

/**
 * API methods for test plans.
 */
export class TestPlansApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all test plans on the given project.
   * GET /1.2/projects/{projectId}/testPlans
   */
  async listTestPlans(
    projectId: string,
    params: Record<string, unknown> = {},
    fullResponse = false,
  ): Promise<z.infer<typeof TestPlansListResponseSchema> | z.infer<typeof TestPlanSchema>[] | null> {
    const response = await this._client.get(`/1.2/projects/${projectId}/testPlans`, params);
    const result = convertToModel(
      response,
      TestPlansListResponseSchema,
      'TestPlansListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllTestPlans(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof TestPlanSchema>[]> {
    const items = await paginate(
      `/1.2/projects/${projectId}/testPlans`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, TestPlanSchema, 'TestPlan');
  }

  /**
   * Browse all test plan items on the given project.
   * GET /1.1/projects/{projectId}/testPlanItems
   */
  async listTestPlanItems(
    projectId: string,
    params: Record<string, unknown> = {},
    fullResponse = false,
  ): Promise<z.infer<typeof TestPlanItemsListResponseSchema> | z.infer<typeof TestPlanItemSchema>[] | null> {
    const response = await this._client.get(`/1.1/projects/${projectId}/testPlanItems`, params);
    const result = convertToModel(
      response,
      TestPlanItemsListResponseSchema,
      'TestPlanItemsListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllTestPlanItems(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof TestPlanItemSchema>[]> {
    const items = await paginate(
      `/1.1/projects/${projectId}/testPlanItems`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, TestPlanItemSchema, 'TestPlanItem');
  }

  /**
   * Browse all test plan item zones on the given project.
   * GET /1.1/projects/{projectId}/testPlanItemZones
   */
  async listTestPlanItemZones(
    projectId: string,
    params: Record<string, unknown> = {},
    fullResponse = false,
  ): Promise<z.infer<typeof TestPlanItemZonesListResponseSchema> | z.infer<typeof TestPlanItemZoneSchema>[] | null> {
    const response = await this._client.get(`/1.1/projects/${projectId}/testPlanItemZones`, params);
    const result = convertToModel(
      response,
      TestPlanItemZonesListResponseSchema,
      'TestPlanItemZonesListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllTestPlanItemZones(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof TestPlanItemZoneSchema>[]> {
    const items = await paginate(
      `/1.1/projects/${projectId}/testPlanItemZones`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, TestPlanItemZoneSchema, 'TestPlanItemZone');
  }

  /**
   * Browse all test plan registrations on the given project.
   * GET /1.1/projects/{projectId}/testPlanRegistrations
   */
  async listTestPlanRegistrations(
    projectId: string,
    params: Record<string, unknown> = {},
    fullResponse = false,
  ): Promise<z.infer<typeof TestPlanRegistrationsListResponseSchema> | z.infer<typeof TestPlanRegistrationSchema>[] | null> {
    const response = await this._client.get(`/1.1/projects/${projectId}/testPlanRegistrations`, params);
    const result = convertToModel(
      response,
      TestPlanRegistrationsListResponseSchema,
      'TestPlanRegistrationsListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllTestPlanRegistrations(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof TestPlanRegistrationSchema>[]> {
    const items = await paginate(
      `/1.1/projects/${projectId}/testPlanRegistrations`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, TestPlanRegistrationSchema, 'TestPlanRegistration');
  }
}
