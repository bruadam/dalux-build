"""Data models for Inspection Plans endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class InspectionPlan(BaseModel):
    """Inspection plan model."""

    inspection_plan_id: str | None = Field(None, alias="inspectionPlanId")
    name: str | None = None
    workpackage_id: str | None = Field(None, alias="workpackageId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class InspectionPlanItem(BaseModel):
    """Inspection plan item model."""

    inspection_plan_item_id: str | None = Field(None, alias="inspectionPlanItemId")
    inspection_plan_id: str | None = Field(None, alias="inspectionPlanId")
    number: str | None = None
    subject: str | None = None
    heading: str | None = None
    sub_heading: str | None = Field(None, alias="subHeading")
    extent_type: str | None = Field(None, alias="extentType")
    planned: int | None = None
    ongoing: int | None = None
    completed: int | None = None
    non_planned_ongoing: int | None = Field(None, alias="nonPlannedOngoing")
    non_planned_completed: int | None = Field(None, alias="nonPlannedCompleted")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class InspectionPlanItemZone(BaseModel):
    """Inspection plan item zone model."""

    inspection_plan_item_id: str | None = Field(None, alias="inspectionPlanItemId")
    inspection_plan_item_zone_id: str | None = Field(None, alias="inspectionPlanItemZoneId")
    name: str | None = None
    planned: int | None = None
    ongoing: int | None = None
    completed: int | None = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class InspectionPlanRegistration(BaseModel):
    """Inspection plan registration model."""

    status: str | None = None
    form_id: str | None = Field(None, alias="formId")
    task_id: str | None = Field(None, alias="taskId")
    inspection_plan_item_id: str | None = Field(None, alias="inspectionPlanItemId")
    inspection_plan_item_zone_id: str | None = Field(None, alias="inspectionPlanItemZoneId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")
