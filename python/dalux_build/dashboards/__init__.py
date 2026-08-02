"""Local Streamlit dashboards for Dalux Build API resources."""

from .api import DashboardApiMixin
from .engine import DashboardHandle, launch_dashboard
from .errors import (
    DashboardError,
    DashboardStartupError,
    DashboardTemplateNotFoundError,
    MissingDashboardDependencies,
)
from .registry import DashboardTemplate, get_template, list_templates

__all__ = [
    "DashboardApiMixin",
    "DashboardError",
    "DashboardHandle",
    "DashboardStartupError",
    "DashboardTemplate",
    "DashboardTemplateNotFoundError",
    "MissingDashboardDependencies",
    "get_template",
    "launch_dashboard",
    "list_templates",
]
