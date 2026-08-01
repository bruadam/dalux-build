"""Data models for Forms endpoint."""

from pydantic import BaseModel, ConfigDict


class Form(BaseModel):
    """Form model."""

    model_config = ConfigDict(populate_by_name=True)
