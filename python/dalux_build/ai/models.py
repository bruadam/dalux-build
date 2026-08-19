"""Data models for AI analysis results."""

from typing import Any

from pydantic import BaseModel, Field


class AiAnalysisResult(BaseModel):
    """Generic result from AI analysis."""

    analysis: str
    structured_data: dict[str, Any] | None = None
    insights: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class HealthReport(BaseModel):
    """Generic health report for any endpoint."""

    resource_type: str
    total_items_analyzed: int
    analysis: str
    issues: list[dict[str, Any]] = Field(default_factory=list)
    summary: str | None = None

    model_config = {"populate_by_name": True}
