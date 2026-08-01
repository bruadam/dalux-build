"""Data models for Test Plans endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class TestPlan(BaseModel):
    """Test plan model."""

    test_plan_id: str | None = Field(None, alias="testPlanId")
    name: str | None = None
    workpackage_id: str | None = Field(None, alias="workpackageId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TestPlanItem(BaseModel):
    """Test plan item model."""

    test_plan_item_id: str | None = Field(None, alias="testPlanItemId")
    test_plan_id: str | None = Field(None, alias="testPlanId")
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


class TestPlanItemZone(BaseModel):
    """Test plan item zone model."""

    test_plan_item_id: str | None = Field(None, alias="testPlanItemId")
    test_plan_item_zone_id: str | None = Field(None, alias="testPlanItemZoneId")
    name: str | None = None
    planned: int | None = None
    ongoing: int | None = None
    completed: int | None = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TestPlanRegistration(BaseModel):
    """Test plan registration model."""

    status: str | None = None
    form_id: str | None = Field(None, alias="formId")
    task_id: str | None = Field(None, alias="taskId")
    test_plan_item_id: str | None = Field(None, alias="testPlanItemId")
    test_plan_item_zone_id: str | None = Field(None, alias="testPlanItemZoneId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")
