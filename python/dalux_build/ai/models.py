"""Data models for AI analysis results."""

from dataclasses import dataclass, field


@dataclass
class AiAnalysisResult:
    """Generic result from AI analysis."""

    analysis: str
    structured_data: dict[str, object] | None = None
    insights: list[str] = field(default_factory=list)


@dataclass
class HealthReport:
    """Generic health report for any endpoint."""

    resource_type: str
    total_items_analyzed: int
    analysis: str
    issues: list[dict[str, object]] = field(default_factory=list)
    summary: str | None = None
