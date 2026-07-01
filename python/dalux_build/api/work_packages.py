"""Work Packages API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..utils.search import find_by_field, find_all_by_field
from ..utils.validation import validate_project_id, validate_file_area_id
from ..utils.pagination import paginate


class WorkPackagesApi:
    """Methods for work packages on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_work_packages(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.0/projects/{projectId}/workpackages."""
        validate_project_id(project_id)
        return self._client.get(
            f"/1.0/projects/{project_id}/workpackages", params=params
        )
