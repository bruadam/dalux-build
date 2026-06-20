"""Data models for Test Plans endpoint."""
from typing import Any

from pydantic import BaseModel


class TestPlan(BaseModel):
    """Test plan model."""

    class Config:
        populate_by_name = True
