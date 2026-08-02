"""Shared dashboard capability for Dalux API namespaces."""

from ..api_client import ApiClient
from ..json_types import JSONDict
from .engine import DashboardHandle, launch_dashboard
from .registry import DashboardTemplate, list_templates


class DashboardApiMixin:
    """Expose resource-scoped dashboards from an API namespace."""

    dashboard_resource: str = ""
    _client: ApiClient

    @property
    def available_dashboards(self) -> tuple[DashboardTemplate, ...]:
        """Return dashboard templates compatible with this API namespace."""
        return list_templates(self.dashboard_resource)

    def dashboard(
        self,
        template: str,
        *,
        template_options: JSONDict | None = None,
        open_browser: bool = True,
        port: int | None = None,
    ) -> DashboardHandle:
        """Launch a local dashboard registered for this API namespace."""
        if not self.dashboard_resource:
            raise RuntimeError("dashboard_resource is not configured for this API namespace")
        return launch_dashboard(
            resource=self.dashboard_resource,
            template=template,
            api_client=self._client,
            template_options=template_options,
            open_browser=open_browser,
            port=port,
        )
