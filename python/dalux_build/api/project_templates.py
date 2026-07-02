"""Project Templates API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..utils.search import find_by_field, find_all_by_field
from ..utils.validation import validate_project_id, validate_file_area_id
from ..utils.pagination import paginate


class ProjectTemplatesApi:
    """Methods for project templates."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_project_templates(
        self, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.1/projectTemplates — All templates on the company profile."""
        return self._client.get("/1.1/projectTemplates", params=params)
