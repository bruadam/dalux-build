"""Data models for Forms endpoint."""
from pydantic import BaseModel


class Form(BaseModel):
    """Form model."""

    class Config:
        populate_by_name = True
