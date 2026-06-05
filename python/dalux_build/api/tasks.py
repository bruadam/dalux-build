"""Tasks API."""
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from ..api_client import ApiClient


def _normalize_task_params(params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    normalized = dict(params or {})
    type_id = normalized.pop("typeId", None)
    if type_id is not None and "$filter" not in normalized:
        escaped_type_id = str(type_id).replace("'", "''")
        normalized["$filter"] = f"data/type/typeId eq '{escaped_type_id}'"
    return normalized


class TasksApi:
    """Methods for tasks, approvals, safety issues, observations and good practices."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_project_tasks(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /5.2/projects/{projectId}/tasks."""
        return self._client.get(
            f"/5.2/projects/{project_id}/tasks",
            params=_normalize_task_params(params),
        )

    def get_all_project_tasks(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> List[Any]:
        """Retrieve all tasks by following bookmark pagination automatically.

        Combines all pages into a single list of items.
        """
        all_items: List[Any] = []
        base_params = _normalize_task_params(params)
        current_params: Dict[str, Any] = dict(base_params)
        has_next_page = True

        while has_next_page:
            response = self._client.get(
                f"/5.2/projects/{project_id}/tasks", params=current_params
            )
            items = response.get("items") if response else None
            if items:
                all_items.extend(items)
            next_link = next(
                (l for l in (response.get("links") or []) if l.get("rel") == "nextPage"),
                None,
            )
            if next_link:
                qs = parse_qs(urlparse(next_link["href"]).query)
                bookmark = qs.get("bookmark", [None])[0]
                current_params = {**base_params, "bookmark": bookmark}
            else:
                has_next_page = False

        return all_items

    def get_task(self, project_id: str, task_id: str) -> Any:
        """GET /3.3/projects/{projectId}/tasks/{taskId}."""
        return self._client.get(f"/3.3/projects/{project_id}/tasks/{task_id}")

    def get_project_task_changes(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /2.2/projects/{projectId}/tasks/changes."""
        return self._client.get(
            f"/2.2/projects/{project_id}/tasks/changes", params=params
        )

    def get_project_task_attachments(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.1/projects/{projectId}/tasks/attachments."""
        return self._client.get(
            f"/1.1/projects/{project_id}/tasks/attachments", params=params
        )
