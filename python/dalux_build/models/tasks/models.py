"""Data models for Tasks endpoint."""
from pydantic import BaseModel


class ApiTaskGet(BaseModel):
    """Task model."""

    class Config:
        populate_by_name = True
