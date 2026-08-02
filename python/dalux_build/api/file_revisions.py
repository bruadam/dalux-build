"""File Revisions API."""

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import JSONValue
from ..utils.validation import resolve_file_area_id, resolve_project_id


class FileRevisionsApi(DashboardApiMixin):
    """Methods for file revision content."""

    dashboard_resource = "file_revisions"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_file_revision_content(
        self,
        file_id: str,
        file_revision_id: str,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> JSONValue | None:
        """GET /2.0/.../files/{fileId}/revisions/{fileRevisionId}/content."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        return self._client.get(
            f"/2.0/projects/{project_id}/file_areas/{file_area_id}"
            f"/files/{file_id}/revisions/{file_revision_id}/content"
        )
