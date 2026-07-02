"""Data models for Users endpoint."""
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class User(BaseModel):
    """User model."""

    user_id: str = Field(..., alias="userId")
    user_type: str = Field(..., alias="userType")
    email: EmailStr
    first_name: Optional[str] = Field(None, alias="firstName")
    last_name: Optional[str] = Field(None, alias="lastName")

    class Config:
        populate_by_name = True


class ProjectUser(User):
    """Project user model."""

    company_id: Optional[str] = Field(None, alias="companyId")

    class Config:
        populate_by_name = True
