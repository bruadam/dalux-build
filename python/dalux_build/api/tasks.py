"""Tasks API."""

import warnings
from typing import TYPE_CHECKING, Literal, cast, overload
from urllib.parse import parse_qs, urlparse

from ..ai import AiMixin
from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import JSONDict, QueryParams
from ..models import (
    Task,
    TaskAttachment,
    TaskAttachmentsListResponse,
    TaskChange,
    TaskListParams,
    TaskResponse,
)
from ..response_converter import (
    convert_to_list_response,
    convert_to_model,
    flatten_items_to_dataframe,
    to_dataframe_or_empty,
)
from ..utils.pagination import paginate
from ..utils.user_mapping import (
    create_company_mapping,
    create_user_mapping,
    enrich_response_with_users,
    enrich_users_with_companies,
)
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


def _extract_and_enrich_created_by_user(
    task_data: JSONDict,
    company_mapping: dict[str, object] | None = None,
) -> JSONDict:
    """Extract user from createdBy and enrich with company at top level.

    Args:
        task_data: Raw task data dict.
        company_mapping: Mapping of company_id to ProjectCompany objects.

    Returns:
        Task data with createdByUser and company at top level.
    """
    result = dict(task_data)

    # Extract user from createdBy and set as createdByUser
    created_by = task_data.get("createdBy")
    if isinstance(created_by, dict):
        user = created_by.get("user")
        if isinstance(user, dict):
            user_obj = dict(user)

            # Enrich user with company if available
            if company_mapping and user_obj.get("company_id"):
                company_id = user_obj["company_id"]
                if company_id in company_mapping:
                    company_obj = company_mapping[company_id]
                    if hasattr(company_obj, "model_dump"):
                        company_dict = cast(JSONDict, company_obj.model_dump(by_alias=False))
                    else:
                        company_dict = cast(JSONDict, company_obj)
                    user_obj["company"] = company_dict
                    result["company"] = company_dict

            result["createdByUser"] = user_obj

    return result


def _normalize_task_params(params: QueryParams | TaskListParams | None) -> QueryParams:
    """Build query params for ``/5.2/projects/.../tasks`` (OData).

    If ``params`` contains ``typeId`` and no ``$filter`` is supplied, it is
    translated to the OData query option expected by the API::

        $filter=data/type/typeId eq '<typeId>'

    The property path matches the task payload shape (``items[].data.type.typeId``).
    Single quotes inside ``typeId`` are escaped per OData (``''``). If ``$filter``
    is already set, ``typeId`` is removed from the outgoing query and not merged
    into ``$filter`` (callers must supply a full filter themselves).
    """
    normalized: QueryParams
    if isinstance(params, TaskListParams):
        normalized = params.model_dump(by_alias=True, exclude_none=True)
    else:
        normalized = dict(params or {})
    type_id = normalized.pop("typeId", None)
    if type_id is not None and "$filter" not in normalized:
        escaped_type_id = str(type_id).replace("'", "''")
        normalized["$filter"] = f"data/type/typeId eq '{escaped_type_id}'"
    return normalized


class TasksApi(AiMixin, DashboardApiMixin):
    """Methods for tasks, approvals, safety issues, observations and good practices."""

    dashboard_resource = "tasks"
    _resource_name = "task"
    __all__ = [
        "get_project_tasks",
        "get_task",
        "get_project_task_changes",
        "get_project_task_attachments",
        "health",
        "ask",
    ]

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def get_project_tasks(
        self,
        params: QueryParams | TaskListParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        recursively_populate: bool = True,
        *,
        project_id: str | None = None,
    ) -> list[Task]: ...

    @overload
    def get_project_tasks(
        self,
        params: QueryParams | TaskListParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        recursively_populate: bool = True,
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...

    def get_project_tasks(
        self,
        params: QueryParams | TaskListParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        recursively_populate: bool = True,
        *,
        project_id: str | None = None,
    ) -> "list[Task] | pd.DataFrame":
        """Retrieve all tasks by following bookmark pagination automatically.

        Combines all pages into a single list of items.

        Uses the same control flow as :meth:`FilesApi.get_files` when the
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
            params: Optional query parameters (OData). ``typeId`` is expanded to
                ``$filter=data/type/typeId eq '<typeId>'`` when ``$filter`` is not
                set. Pagination ``bookmark`` is applied automatically across pages.
            verbose: If ``True``, print progress using the same pattern as
                :meth:`FilesApi.get_files`, plus the next page URL when present.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas) instead of a list.
            recursively_populate: If True, recursively populate user and company
                objects from their IDs (requires one additional API call to fetch project users).
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        all_items: list[Task] = []
        base_params = _normalize_task_params(params)
        current_params: QueryParams = dict(base_params)
        has_next_page = True
        # When only totalItems exists, max(...) across pages matches the full list size
        # (first pages carry the largest value); later pages may report a stale non-zero.
        tasks_items_ceiling: int | None = None

        if recursively_populate:
            from .companies import CompaniesApi
            from .users import UsersApi

            users_api = UsersApi(self._client)
            users = users_api.list_project_users(project_id=project_id)
            user_mapping = create_user_mapping(users)

            # Fetch project companies and create mapping
            companies_api = CompaniesApi(self._client)
            companies = companies_api.list_project_companies(project_id=project_id)
            company_mapping = create_company_mapping(companies)
        else:
            user_mapping = None
            company_mapping = None

        while has_next_page:
            raw_response = self._client.get(
                f"/5.2/projects/{project_id}/tasks", params=current_params
            )
            response: JSONDict = raw_response if isinstance(raw_response, dict) else {}
            raw_items = response.get("items")
            items: list[Task] = []
            if isinstance(raw_items, list):
                for item in raw_items:
                    task_data = (
                        item.get("data") if isinstance(item, dict) and "data" in item else item
                    )
                    if isinstance(task_data, dict):
                        if user_mapping:
                            task_data = cast(
                                JSONDict,
                                enrich_response_with_users(
                                    task_data,
                                    user_mapping,
                                    {"userId": "user"},
                                ),
                            )
                        if company_mapping:
                            task_data = _extract_and_enrich_created_by_user(
                                task_data, cast(dict[str, object], company_mapping)
                            )
                        items.append(Task.model_validate(task_data))
            if items:
                all_items.extend(items)

            meta = response.get("metadata")
            meta = meta if isinstance(meta, dict) else {}
            total_remaining = meta.get("totalRemainingItems")
            total_items = meta.get("totalItems")
            if "totalRemainingItems" in meta and isinstance(total_remaining, (int, float, str)):
                remaining = int(total_remaining)
                use_files_remaining_stop = True
            elif "totalItems" in meta and isinstance(total_items, (int, float, str)):
                ti = int(total_items)
                tasks_items_ceiling = max(tasks_items_ceiling or 0, ti)
                remaining = ti
                use_files_remaining_stop = False
            else:
                remaining = 0
                use_files_remaining_stop = True

            links = response.get("links")
            next_link = next(
                (
                    link
                    for link in (links if isinstance(links, list) else [])
                    if isinstance(link, dict) and link.get("rel") == "nextPage"
                ),
                None,
            )
            next_href = next_link.get("href") if next_link else None

            if verbose:
                next_part = f" next: {next_href}" if next_href else " next: (none)"
                if use_files_remaining_stop:
                    print(
                        f"Retrieved {len(all_items)} tasks so far, "
                        f"{remaining} remaining...{next_part}"
                    )
                elif tasks_items_ceiling is not None:
                    rem_v = max(0, tasks_items_ceiling - len(all_items))
                    print(
                        f"Retrieved {len(all_items)} tasks so far, {rem_v} remaining...{next_part}"
                    )
                else:
                    print(
                        f"Retrieved {len(all_items)} tasks so far, "
                        f"{remaining} remaining...{next_part}"
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
                if isinstance(next_href, str):
                    qs = parse_qs(urlparse(next_href).query)
                    bookmark = qs.get("bookmark", [None])[0]
                    current_params = {**base_params, "bookmark": bookmark}
                else:
                    has_next_page = False

        if verbose:
            print(f"Done. Total tasks retrieved: {len(all_items)}")

        if to_dataframe:
            return flatten_items_to_dataframe(list(all_items))
        return all_items

    def get_all_project_tasks(
        self,
        params: QueryParams | TaskListParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        recursively_populate: bool = True,
        *,
        project_id: str | None = None,
    ) -> "list[Task] | pd.DataFrame":
        """Retrieve all tasks by following bookmark pagination automatically.

        .. deprecated::
            Use :meth:`get_project_tasks` instead.

        Args:
            params: Optional query parameters (OData).
            verbose: If ``True``, print progress.
            to_dataframe: If True, return as DataFrame.
            recursively_populate: If True, populate user objects.
            project_id: Project ID. Falls back to the client's configured default.
        """
        warnings.warn(
            "get_all_project_tasks() is deprecated. Use get_project_tasks() instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        result = self.get_project_tasks(
            params=params,
            verbose=verbose,
            to_dataframe=to_dataframe,
            recursively_populate=recursively_populate,
            project_id=project_id,
        )  # type: ignore[call-overload]
        return cast("list[Task] | pd.DataFrame", result)

    def get_task(self, task_id: str, *, project_id: str | None = None) -> TaskResponse | None:
        """GET /3.3/projects/{projectId}/tasks/{taskId}.

        Returns:
            TaskResponse with task details.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/3.3/projects/{project_id}/tasks/{task_id}")
        return convert_to_model(response, TaskResponse)

    @overload
    def get_project_task_changes(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        recursively_populate: bool = True,
        *,
        project_id: str | None = None,
    ) -> list[TaskChange]: ...

    @overload
    def get_project_task_changes(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        recursively_populate: bool = True,
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...

    def get_project_task_changes(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        recursively_populate: bool = True,
        *,
        project_id: str | None = None,
    ) -> "list[TaskChange] | pd.DataFrame":
        """Retrieve all task changes by following bookmark pagination.

        Args:
            params: Optional query parameters. Pagination ``bookmark`` is applied
                automatically across pages.
            verbose: If ``True``, print page-by-page pagination progress.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas) instead of a list.
            recursively_populate: If True, recursively populate user and company
                objects from their IDs (requires one additional API call to fetch project users).
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of task change objects across all available pages, or a
            DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)

        if recursively_populate:
            from .companies import CompaniesApi
            from .users import UsersApi

            users_api = UsersApi(self._client)
            users = users_api.list_project_users(project_id=project_id)
            user_mapping = create_user_mapping(users)

            # Fetch project companies and create mapping
            companies_api = CompaniesApi(self._client)
            companies = companies_api.list_project_companies(project_id=project_id)
            company_mapping = create_company_mapping(companies)
        else:
            user_mapping = None
            company_mapping = None

        raw_items = paginate(
            endpoint=f"/2.2/projects/{project_id}/tasks/changes",
            client=self._client,
            params=params,
            verbose=verbose,
            item_accessor="items",
        )
        typed_items: list[TaskChange] = []
        for item in raw_items:
            if isinstance(item, dict):
                if user_mapping:
                    item = cast(
                        JSONDict,
                        enrich_response_with_users(
                            item,
                            user_mapping,
                            {"userId": "user"},
                        ),
                    )
                if company_mapping and user_mapping:
                    item = cast(JSONDict, enrich_users_with_companies(item, company_mapping))
                typed_items.append(TaskChange.model_validate(item))
        if to_dataframe:
            return flatten_items_to_dataframe(list(typed_items))
        return typed_items

    def get_all_project_task_changes(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        recursively_populate: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[TaskChange] | pd.DataFrame":
        """Retrieve all task changes by following bookmark pagination.

        .. deprecated::
            Use :meth:`get_project_task_changes` instead.

        Args:
            params: Optional query parameters.
            verbose: If ``True``, print progress.
            to_dataframe: If True, return as DataFrame.
            recursively_populate: If True, populate user objects.
            project_id: Project ID. Falls back to the client's configured default.
        """
        warnings.warn(
            "get_all_project_task_changes() is deprecated. Use get_project_task_changes() instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        result = self.get_project_task_changes(
            params=params,
            verbose=verbose,
            to_dataframe=to_dataframe,
            recursively_populate=recursively_populate,
            project_id=project_id,
        )  # type: ignore[call-overload]
        return cast("list[TaskChange] | pd.DataFrame", result)

    @overload
    def get_project_task_attachments(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TaskAttachment]: ...
    @overload
    def get_project_task_attachments(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> TaskAttachmentsListResponse | None: ...
    @overload
    def get_project_task_attachments(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_project_task_attachments(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "TaskAttachmentsListResponse | list[TaskAttachment] | pd.DataFrame | None":
        """GET /1.1/projects/{projectId}/tasks/attachments.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TaskAttachmentsListResponse
                (including metadata and links). If False (default), return
                just the list of TaskAttachment items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.1/projects/{project_id}/tasks/attachments", params=params)
        if isinstance(response, list):
            response = {"items": response}
        result = convert_to_list_response(response, TaskAttachmentsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def _fetch_all_data(self, **kwargs: object) -> list[object]:
        """Fetch all tasks using get_project_tasks."""
        project_id = cast(str | None, kwargs.get("project_id"))
        result = self.get_project_tasks(
            project_id=project_id,
            verbose=False,
        )
        return cast(list[object], result)

    def _format_data_for_analysis(self, data: list[object]) -> str:
        """Format tasks for AI analysis."""
        import pprint

        formatted_tasks = []
        for t in data[:50]:  # Limit to 50 tasks for analysis
            if isinstance(t, Task):
                formatted_tasks.append(t.model_dump(by_alias=True))
            elif isinstance(t, dict):
                formatted_tasks.append(t)

        return pprint.pformat(formatted_tasks)[:8000]
