import { z } from 'zod';
import { listResponseSchema } from '../helpers';

const optionalString = z.string().nullish();
const optionalInteger = z.number().int().nullish();

export const TestPlanSchema = z.object({
  testPlanId: optionalString,
  name: optionalString,
  workpackageId: optionalString,
}).passthrough();

export const TestPlanItemSchema = z.object({
  testPlanItemId: optionalString,
  testPlanId: optionalString,
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

export const TestPlanItemZoneSchema = z.object({
  testPlanItemId: optionalString,
  testPlanItemZoneId: optionalString,
  name: optionalString,
  planned: optionalInteger,
  ongoing: optionalInteger,
  completed: optionalInteger,
}).passthrough();

export const TestPlanRegistrationSchema = z.object({
  status: optionalString,
  formId: optionalString,
  taskId: optionalString,
  testPlanItemId: optionalString,
  testPlanItemZoneId: optionalString,
}).passthrough();

export const TestPlansListResponseSchema = listResponseSchema(TestPlanSchema);
export const TestPlanItemsListResponseSchema = listResponseSchema(TestPlanItemSchema);
export const TestPlanItemZonesListResponseSchema = listResponseSchema(TestPlanItemZoneSchema);
export const TestPlanRegistrationsListResponseSchema = listResponseSchema(TestPlanRegistrationSchema);
