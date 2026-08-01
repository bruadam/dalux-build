'use strict';

const { z } = require('zod');
const { listResponseSchema } = require('../helpers');

const optionalString = z.string().nullish();
const optionalInteger = z.number().int().nullish();

const TestPlanSchema = z.object({
  testPlanId: optionalString,
  name: optionalString,
  workpackageId: optionalString,
}).passthrough();

const TestPlanItemSchema = z.object({
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

const TestPlanItemZoneSchema = z.object({
  testPlanItemId: optionalString,
  testPlanItemZoneId: optionalString,
  name: optionalString,
  planned: optionalInteger,
  ongoing: optionalInteger,
  completed: optionalInteger,
}).passthrough();

const TestPlanRegistrationSchema = z.object({
  status: optionalString,
  formId: optionalString,
  taskId: optionalString,
  testPlanItemId: optionalString,
  testPlanItemZoneId: optionalString,
}).passthrough();

const TestPlansListResponseSchema = listResponseSchema(TestPlanSchema);
const TestPlanItemsListResponseSchema = listResponseSchema(TestPlanItemSchema);
const TestPlanItemZonesListResponseSchema = listResponseSchema(TestPlanItemZoneSchema);
const TestPlanRegistrationsListResponseSchema = listResponseSchema(TestPlanRegistrationSchema);

module.exports = {
  TestPlanSchema,
  TestPlanItemSchema,
  TestPlanItemZoneSchema,
  TestPlanRegistrationSchema,
  TestPlansListResponseSchema,
  TestPlanItemsListResponseSchema,
  TestPlanItemZonesListResponseSchema,
  TestPlanRegistrationsListResponseSchema,
};
