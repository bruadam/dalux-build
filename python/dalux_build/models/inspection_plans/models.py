"""Data models for Inspection Plans endpoint."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class InspectionPlan(BaseModel):
    """Inspection plan model."""

    inspection_plan_id: Optional[str] = Field(None, alias="inspectionPlanId")
    name: Optional[str] = None
    workpackage_id: Optional[str] = Field(None, alias="workpackageId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class InspectionPlanItem(BaseModel):
    """Inspection plan item model."""

    inspection_plan_item_id: Optional[str] = Field(None, alias="inspectionPlanItemId")
    inspection_plan_id: Optional[str] = Field(None, alias="inspectionPlanId")
    number: Optional[str] = None
    subject: Optional[str] = None
    heading: Optional[str] = None
    sub_heading: Optional[str] = Field(None, alias="subHeading")
    extent_type: Optional[str] = Field(None, alias="extentType")
    planned: Optional[int] = None
    ongoing: Optional[int] = None
    completed: Optional[int] = None
    non_planned_ongoing: Optional[int] = Field(None, alias="nonPlannedOngoing")
    non_planned_completed: Optional[int] = Field(None, alias="nonPlannedCompleted")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class InspectionPlanItemZone(BaseModel):
    """Inspection plan item zone model."""

    inspection_plan_item_id: Optional[str] = Field(None, alias="inspectionPlanItemId")
    inspection_plan_item_zone_id: Optional[str] = Field(None, alias="inspectionPlanItemZoneId")
    name: Optional[str] = None
    planned: Optional[int] = None
    ongoing: Optional[int] = None
    completed: Optional[int] = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class InspectionPlanRegistration(BaseModel):
    """Inspection plan registration model."""

    status: Optional[str] = None
    form_id: Optional[str] = Field(None, alias="formId")
    task_id: Optional[str] = Field(None, alias="taskId")
    inspection_plan_item_id: Optional[str] = Field(None, alias="inspectionPlanItemId")
    inspection_plan_item_zone_id: Optional[str] = Field(None, alias="inspectionPlanItemZoneId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")
