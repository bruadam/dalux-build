'use strict';

const { z } = require('zod');
const { listResponseSchema } = require('../helpers');

const optionalString = z.string().nullish();
const optionalInteger = z.number().int().nullish();

const InspectionPlanSchema = z.object({
  inspectionPlanId: optionalString,
  name: optionalString,
  workpackageId: optionalString,
}).passthrough();

const InspectionPlanItemSchema = z.object({
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

const InspectionPlanItemZoneSchema = z.object({
  inspectionPlanItemId: optionalString,
  inspectionPlanItemZoneId: optionalString,
  name: optionalString,
  planned: optionalInteger,
  ongoing: optionalInteger,
  completed: optionalInteger,
}).passthrough();

const InspectionPlanRegistrationSchema = z.object({
  status: optionalString,
  formId: optionalString,
  taskId: optionalString,
  inspectionPlanItemId: optionalString,
  inspectionPlanItemZoneId: optionalString,
}).passthrough();

const InspectionPlansListResponseSchema = listResponseSchema(InspectionPlanSchema);
const InspectionPlanItemsListResponseSchema = listResponseSchema(InspectionPlanItemSchema);
const InspectionPlanItemZonesListResponseSchema = listResponseSchema(InspectionPlanItemZoneSchema);
const InspectionPlanRegistrationsListResponseSchema = listResponseSchema(InspectionPlanRegistrationSchema);

module.exports = {
  InspectionPlanSchema,
  InspectionPlanItemSchema,
  InspectionPlanItemZoneSchema,
  InspectionPlanRegistrationSchema,
  InspectionPlansListResponseSchema,
  InspectionPlanItemsListResponseSchema,
  InspectionPlanItemZonesListResponseSchema,
  InspectionPlanRegistrationsListResponseSchema,
};
