"""Data models for Test Plans endpoint."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class TestPlan(BaseModel):
    """Test plan model."""

    test_plan_id: Optional[str] = Field(None, alias="testPlanId")
    name: Optional[str] = None
    workpackage_id: Optional[str] = Field(None, alias="workpackageId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TestPlanItem(BaseModel):
    """Test plan item model."""

    test_plan_item_id: Optional[str] = Field(None, alias="testPlanItemId")
    test_plan_id: Optional[str] = Field(None, alias="testPlanId")
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


class TestPlanItemZone(BaseModel):
    """Test plan item zone model."""

    test_plan_item_id: Optional[str] = Field(None, alias="testPlanItemId")
    test_plan_item_zone_id: Optional[str] = Field(None, alias="testPlanItemZoneId")
    name: Optional[str] = None
    planned: Optional[int] = None
    ongoing: Optional[int] = None
    completed: Optional[int] = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TestPlanRegistration(BaseModel):
    """Test plan registration model."""

    status: Optional[str] = None
    form_id: Optional[str] = Field(None, alias="formId")
    task_id: Optional[str] = Field(None, alias="taskId")
    test_plan_item_id: Optional[str] = Field(None, alias="testPlanItemId")
    test_plan_item_zone_id: Optional[str] = Field(None, alias="testPlanItemZoneId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")
