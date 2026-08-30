import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { convertToModel, convertToModelList } from '../models/convert';
import { paginate } from '../utils/pagination';
import {
  InspectionPlanSchema,
  InspectionPlanItemSchema,
  InspectionPlanItemZoneSchema,
  InspectionPlanRegistrationSchema,
  InspectionPlansListResponseSchema,
  InspectionPlanItemsListResponseSchema,
  InspectionPlanItemZonesListResponseSchema,
  InspectionPlanRegistrationsListResponseSchema,
} from '../models/inspectionPlans';

/**
 * API methods for inspection plans.
 */
export class InspectionPlansApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all inspection plans on the given project.
   * GET /1.2/projects/{projectId}/inspectionPlans
   */
  async listInspectionPlans(
    projectId: string,
    params: Record<string, unknown> = {},
    fullResponse = false,
  ): Promise<z.infer<typeof InspectionPlansListResponseSchema> | z.infer<typeof InspectionPlanSchema>[] | null> {
    const response = await this._client.get(`/1.2/projects/${projectId}/inspectionPlans`, params);
    const result = convertToModel(
      response,
      InspectionPlansListResponseSchema,
      'InspectionPlansListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllInspectionPlans(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof InspectionPlanSchema>[]> {
    const items = await paginate(
      `/1.2/projects/${projectId}/inspectionPlans`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, InspectionPlanSchema, 'InspectionPlan');
  }

  /**
   * Browse all inspection plan items on the given project.
   * GET /1.1/projects/{projectId}/inspectionPlanItems
   */
  async listInspectionPlanItems(
    projectId: string,
    params: Record<string, unknown> = {},
    fullResponse = false,
  ): Promise<z.infer<typeof InspectionPlanItemsListResponseSchema> | z.infer<typeof InspectionPlanItemSchema>[] | null> {
    const response = await this._client.get(`/1.1/projects/${projectId}/inspectionPlanItems`, params);
    const result = convertToModel(
      response,
      InspectionPlanItemsListResponseSchema,
      'InspectionPlanItemsListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllInspectionPlanItems(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof InspectionPlanItemSchema>[]> {
    const items = await paginate(
      `/1.1/projects/${projectId}/inspectionPlanItems`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, InspectionPlanItemSchema, 'InspectionPlanItem');
  }

  /**
   * Browse all inspection plan item zones on the given project.
   * GET /1.1/projects/{projectId}/inspectionPlanItemZones
   */
  async listInspectionPlanItemZones(
    projectId: string,
    params: Record<string, unknown> = {},
    fullResponse = false,
  ): Promise<z.infer<typeof InspectionPlanItemZonesListResponseSchema> | z.infer<typeof InspectionPlanItemZoneSchema>[] | null> {
    const response = await this._client.get(`/1.1/projects/${projectId}/inspectionPlanItemZones`, params);
    const result = convertToModel(
      response,
      InspectionPlanItemZonesListResponseSchema,
      'InspectionPlanItemZonesListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllInspectionPlanItemZones(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof InspectionPlanItemZoneSchema>[]> {
    const items = await paginate(
      `/1.1/projects/${projectId}/inspectionPlanItemZones`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, InspectionPlanItemZoneSchema, 'InspectionPlanItemZone');
  }

  /**
   * Browse all inspection plan registrations on the given project.
   * GET /2.1/projects/{projectId}/inspectionPlanRegistrations
   */
  async listInspectionPlanRegistrations(
    projectId: string,
    params: Record<string, unknown> = {},
    fullResponse = false,
  ): Promise<z.infer<typeof InspectionPlanRegistrationsListResponseSchema> | z.infer<typeof InspectionPlanRegistrationSchema>[] | null> {
    const response = await this._client.get(
      `/2.1/projects/${projectId}/inspectionPlanRegistrations`,
      params,
    );
    const result = convertToModel(
      response,
      InspectionPlanRegistrationsListResponseSchema,
      'InspectionPlanRegistrationsListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllInspectionPlanRegistrations(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof InspectionPlanRegistrationSchema>[]> {
    const items = await paginate(
      `/2.1/projects/${projectId}/inspectionPlanRegistrations`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, InspectionPlanRegistrationSchema, 'InspectionPlanRegistration');
  }
}
