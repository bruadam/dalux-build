"""Data models for Inspection Plans endpoint."""
from typing import Any, Optional

from pydantic import BaseModel


class InspectionPlan(BaseModel):
    """Inspection plan model."""

    class Config:
        populate_by_name = True
