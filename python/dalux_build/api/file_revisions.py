"""File Revisions API."""
from ..api_client import ApiClient
from ..utils.search import find_by_field, find_all_by_field
from ..utils.validation import validate_project_id, validate_file_area_id
from ..utils.pagination import paginate


class FileRevisionsApi:
    """Methods for file revision content."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_file_revision_content(
        self,
        project_id: str,
        file_area_id: str,
        file_id: str,
        file_revision_id: str,
    ):
        """GET /2.0/.../files/{fileId}/revisions/{fileRevisionId}/content."""
        validate_project_id(project_id)
        validate_file_area_id(file_area_id)
        return self._client.get(
            f"/2.0/projects/{project_id}/file_areas/{file_area_id}"
            f"/files/{file_id}/revisions/{file_revision_id}/content"
        )
