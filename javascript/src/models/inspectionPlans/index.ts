import { z } from 'zod';
import { listResponseSchema } from '../helpers';

const optionalString = z.string().nullish();
const optionalInteger = z.number().int().nullish();

export const InspectionPlanSchema = z.object({
  inspectionPlanId: optionalString,
  name: optionalString,
  workpackageId: optionalString,
}).passthrough();

export const InspectionPlanItemSchema = z.object({
  inspectionPlanItemId: optionalString,
  inspectionPlanId: optionalString,
  number: optionalString,
  subject: optionalString,
  heading: optionalString,
  subHeading: optionalString,
  extentType: optionalString,
  planned: optionalInteger,
  ongoing: optionalInteger,
  completed: optionalInteger,
  nonPlannedOngoing: optionalInteger,
  nonPlannedCompleted: optionalInteger,
}).passthrough();

export const InspectionPlanItemZoneSchema = z.object({
  inspectionPlanItemId: optionalString,
  inspectionPlanItemZoneId: optionalString,
  name: optionalString,
  planned: optionalInteger,
  ongoing: optionalInteger,
  completed: optionalInteger,
}).passthrough();

export const InspectionPlanRegistrationSchema = z.object({
  status: optionalString,
  formId: optionalString,
  taskId: optionalString,
  inspectionPlanItemId: optionalString,
  inspectionPlanItemZoneId: optionalString,
}).passthrough();

export const InspectionPlansListResponseSchema = listResponseSchema(InspectionPlanSchema);
export const InspectionPlanItemsListResponseSchema = listResponseSchema(InspectionPlanItemSchema);
export const InspectionPlanItemZonesListResponseSchema = listResponseSchema(InspectionPlanItemZoneSchema);
export const InspectionPlanRegistrationsListResponseSchema = listResponseSchema(InspectionPlanRegistrationSchema);
