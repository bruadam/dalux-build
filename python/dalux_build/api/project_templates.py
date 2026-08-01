"""Project Templates API."""

from ..api_client import ApiClient
from ..json_types import JSONValue, QueryParams


class ProjectTemplatesApi:
    """Methods for project templates."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_project_templates(self, params: QueryParams | None = None) -> JSONValue | None:
        """GET /1.1/projectTemplates — All templates on the company profile."""
        return self._client.get("/1.1/projectTemplates", params=params)
