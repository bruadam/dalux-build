"""Data models for Work Packages endpoint."""
from pydantic import BaseModel


class WorkPackage(BaseModel):
    """Work package model."""

    class Config:
        populate_by_name = True
