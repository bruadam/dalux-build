"""Tasks API."""
from typing import Any, Dict, List, Optional, Union
from urllib.parse import parse_qs, urlparse

from ..api_client import ApiClient
from ..models import (
    Task,
    TaskAttachmentsListResponse,
    TaskChange,
    TaskChanges,
    TaskListParams,
    TaskResponse,
    TasksListResponse,
)
from ..response_converter import convert_to_model
from ..utils.pagination import paginate


def _normalize_task_params(
    params: Optional[Union[Dict[str, Any], TaskListParams]]
) -> Dict[str, Any]:
    """Build query params for ``/5.2/projects/.../tasks`` (OData).

    If ``params`` contains ``typeId`` and no ``$filter`` is supplied, it is
    translated to the OData query option expected by the API::

        $filter=data/type/typeId eq '<typeId>'

    The property path matches the task payload shape (``items[].data.type.typeId``).
    Single quotes inside ``typeId`` are escaped per OData (``''``). If ``$filter``
    is already set, ``typeId`` is removed from the outgoing query and not merged
    into ``$filter`` (callers must supply a full filter themselves).
    """
    if isinstance(params, TaskListParams):
        normalized = params.model_dump(by_alias=True, exclude_none=True)
    else:
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
        self,
        project_id: str,
        params: Optional[Union[Dict[str, Any], TaskListParams]] = None,
    ) -> Optional[TasksListResponse]:
        """GET /5.2/projects/{projectId}/tasks.

        Args:
            project_id: Project ID.
            params: Optional query parameters. Pass ``typeId`` as a shorthand for
                the OData ``$filter`` on task type (see :func:`_normalize_task_params`).
                You may also pass ``$filter`` directly; other OData query options
                supported by the API may be included as usual.

        Returns:
            TasksListResponse with type-safe access to tasks.
        """
        response = self._client.get(
            f"/5.2/projects/{project_id}/tasks",
            params=_normalize_task_params(params),
        )
        return convert_to_model(response, TasksListResponse)

    def get_all_project_tasks(
        self,
        project_id: str,
        params: Optional[Union[Dict[str, Any], TaskListParams]] = None,
        verbose: bool = False,
    ) -> List[Task]:
        """Retrieve all tasks by following bookmark pagination automatically.

        Combines all pages into a single list of items.

        Uses the same control flow as :meth:`FilesApi.get_all_files` when the
        response includes ``metadata.totalRemainingItems``: stop when it reaches
        ``0``, otherwise follow ``nextPage``.

        Tasks 5.2 often omit ``totalRemainingItems`` and only send ``metadata.totalItems``,
        which shrinks each page but may **never reach zero** while ``nextPage`` is still
        present (server bug or inconsistent metadata). In that case the client tracks
        the **maximum** ``totalItems`` seen across pages as the row-count ceiling for
        the query and stops once that many items have been collected, so pagination
        cannot run forever. Verbose progress uses the same ``… remaining`` wording,
        derived from that ceiling when not using ``totalRemainingItems``.

        If neither metadata field exists, ``remaining`` defaults to ``0`` (as in files).

        Args:
            project_id: Project ID.
            params: Optional query parameters (OData). ``typeId`` is expanded to
                ``$filter=data/type/typeId eq '<typeId>'`` when ``$filter`` is not
                set (same as :meth:`get_project_tasks`). Pagination ``bookmark`` is
                applied automatically across pages.
            verbose: If ``True``, print progress using the same pattern as
                :meth:`FilesApi.get_all_files`, plus the next page URL when present.
        """
        all_items: List[Task] = []
        base_params = _normalize_task_params(params)
        current_params: Dict[str, Any] = dict(base_params)
        has_next_page = True
        # When only totalItems exists, max(...) across pages matches the full list size
        # (first pages carry the largest value); later pages may report a stale non-zero.
        tasks_items_ceiling: Optional[int] = None

        while has_next_page:
            response = self._client.get(
                f"/5.2/projects/{project_id}/tasks", params=current_params
            )
            raw_items = response.get("items") if response else None
            items: List[Task] = []
            if isinstance(raw_items, list):
                for item in raw_items:
                    task_data = (
                        item.get("data") if isinstance(item, dict) and "data" in item else item
                    )
                    if isinstance(task_data, Task):
                        items.append(task_data)
                    elif isinstance(task_data, dict):
                        items.append(Task.model_validate(task_data))
            if items:
                all_items.extend(items)
            meta = (response or {}).get("metadata") or {}
            if "totalRemainingItems" in meta:
                remaining = int(meta["totalRemainingItems"])
                use_files_remaining_stop = True
            elif "totalItems" in meta:
                ti = int(meta["totalItems"])
                tasks_items_ceiling = max(tasks_items_ceiling or 0, ti)
                remaining = ti
                use_files_remaining_stop = False
            else:
                remaining = 0
                use_files_remaining_stop = True

            next_link = next(
                (l for l in (response.get("links") or []) if l.get("rel") == "nextPage"),
                None,
            )
            next_href = next_link.get("href") if next_link else None

            if verbose:
                next_part = f" next: {next_href}" if next_href else " next: (none)"
                if use_files_remaining_stop:
                    print(
                        f"Retrieved {len(all_items)} tasks so far, {remaining} remaining...{next_part}"
                    )
                elif tasks_items_ceiling is not None:
                    rem_v = max(0, tasks_items_ceiling - len(all_items))
                    print(
                        f"Retrieved {len(all_items)} tasks so far, {rem_v} remaining...{next_part}"
                    )
                else:
                    print(
                        f"Retrieved {len(all_items)} tasks so far, {remaining} remaining...{next_part}"
                    )

            if not items:
                has_next_page = False
            elif use_files_remaining_stop and remaining == 0:
                has_next_page = False
            elif (
                not use_files_remaining_stop
                and tasks_items_ceiling is not None
                and len(all_items) >= tasks_items_ceiling
            ):
                has_next_page = False
            else:
                if next_link:
                    qs = parse_qs(urlparse(next_link["href"]).query)
                    bookmark = qs.get("bookmark", [None])[0]
                    current_params = {**base_params, "bookmark": bookmark}
                else:
                    has_next_page = False

        if verbose:
            print(f"Done. Total tasks retrieved: {len(all_items)}")
        return all_items

    def get_task(self, project_id: str, task_id: str) -> Optional[TaskResponse]:
        """GET /3.3/projects/{projectId}/tasks/{taskId}.

        Returns:
            TaskResponse with task details.
        """
        response = self._client.get(f"/3.3/projects/{project_id}/tasks/{task_id}")
        return convert_to_model(response, TaskResponse)

    def get_project_task_changes(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[TaskChanges]:
        """GET /2.2/projects/{projectId}/tasks/changes.

        Returns:
            TaskChanges model with a typed ``items`` collection.
        """
        response = self._client.get(
            f"/2.2/projects/{project_id}/tasks/changes", params=params
        )
        return convert_to_model(response, TaskChanges)

    def get_all_project_task_changes(
        self,
        project_id: str,
        params: Optional[Dict[str, Any]] = None,
        verbose: bool = False,
    ) -> List[TaskChange]:
        """Retrieve all task changes by following bookmark pagination.

        Args:
            project_id: Project ID.
            params: Optional query parameters. Pagination ``bookmark`` is applied
                automatically across pages.
            verbose: If ``True``, print page-by-page pagination progress.

        Returns:
            List of task change objects across all available pages.
        """
        raw_items = paginate(
            endpoint=f"/2.2/projects/{project_id}/tasks/changes",
            client=self._client,
            params=params,
            verbose=verbose,
            item_accessor="items",
        )
        typed_items: List[TaskChange] = []
        for item in raw_items:
            if isinstance(item, TaskChange):
                typed_items.append(item)
            elif isinstance(item, dict):
                typed_items.append(TaskChange.model_validate(item))
        return typed_items

    def get_project_task_attachments(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[TaskAttachmentsListResponse]:
        """GET /1.1/projects/{projectId}/tasks/attachments."""
        response = self._client.get(
            f"/1.1/projects/{project_id}/tasks/attachments", params=params
        )
        if isinstance(response, list):
            response = {"items": response}
        return convert_to_model(response, TaskAttachmentsListResponse)
