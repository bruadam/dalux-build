"""Data models for Users endpoint."""

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, EmailStr, Field

if TYPE_CHECKING:
    from ..projects import ProjectCompany


class User(BaseModel):
    """User model."""

    user_id: str = Field(..., alias="userId")
    user_type: str = Field(..., alias="userType")
    email: EmailStr
    first_name: str | None = Field(None, alias="firstName")
    last_name: str | None = Field(None, alias="lastName")

    model_config = ConfigDict(populate_by_name=True)


class ProjectUser(User):
    """Project user model."""

    company_id: str | None = Field(None, alias="companyId")
    company: "ProjectCompany | None" = Field(None)

    model_config = ConfigDict(populate_by_name=True)
