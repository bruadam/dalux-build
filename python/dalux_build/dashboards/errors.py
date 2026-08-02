"""Errors raised by the dashboard framework."""


class DashboardError(Exception):
    """Base class for dashboard errors."""


class DashboardTemplateNotFoundError(DashboardError, ValueError):
    """Raised when a template is unavailable for an API resource."""


class MissingDashboardDependencies(DashboardError, ImportError):
    """Raised when optional dashboard dependencies are not installed."""

    def __init__(self) -> None:
        super().__init__(
            "Dashboards require the 'dashboard' extra: pip install 'dalux-build[dashboard]'"
        )


class DashboardStartupError(DashboardError, RuntimeError):
    """Raised when a dashboard process cannot be started."""
