"""Files API."""

import json
import os
from typing import TYPE_CHECKING, Literal, Protocol, overload

import requests

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import JSONDict, JSONValue, QueryParams
from ..models import File, FileArea, FileNameFilter, FileResponse, FilesListResponse
from ..response_converter import (
    convert_to_list_response,
    convert_to_model,
    flatten_items_to_dataframe,
    to_dataframe_or_empty,
)
from ..utils.download import download_file_with_metadata as shared_download_file_with_metadata
from ..utils.file_filter import filter_files_by_name
from ..utils.pagination import paginate
from ..utils.path_resolver import resolve_folder_id_from_named_path
from ..utils.search import find_all_by_field, find_by_field
from ..utils.user_mapping import (
    create_company_mapping,
    create_user_mapping,
    enrich_response_with_users,
)
from ..utils.validation import resolve_file_area_id, resolve_project_id, validate_folder_id

if TYPE_CHECKING:
    import pandas as pd

    from .folders import FolderLike, FoldersApi, TreeNode


class _ProgressBar(Protocol):
    """The subset of tqdm's interface used for download progress."""

    def update(self, n: float) -> bool | None: ...
    def close(self) -> None: ...


try:
    from tqdm import tqdm
except ImportError:
    # tqdm's own constructor signature is too large/generic to model with a
    # Protocol; the `progress: _ProgressBar | None` annotation at the call
    # site (below) is what keeps this optional dependency out of our own
    # type surface.
    tqdm = None  # type: ignore[assignment, misc]

# get_all_files() falls back to the raw payload (dict) when a page's item
# can't be validated as a File, so callers must handle both shapes.
FileLike = File | JSONDict


def _file_payload(item: FileLike) -> JSONDict:
    """Normalize a File object or raw API item into a plain field dict."""
    if isinstance(item, File):
        return item.model_dump(by_alias=True)
    if "data" in item:
        data = item.get("data")
        return data if isinstance(data, dict) else {}
    return item


class FilesApi(DashboardApiMixin):
    """Methods for files within a file area."""

    dashboard_resource = "files"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def _print_endpoint(
        self,
        method: str,
        path: str,
        params: QueryParams | None = None,
        verbose: bool = False,
    ) -> None:
        """Print endpoint details when verbose mode is enabled."""
        if not verbose:
            return
        if params:
            print(f"{method} {path} params={params}")
        else:
            print(f"{method} {path}")

    def _get_local_file_path(self, file_name: str, save_path: str | None = None) -> str:
        """Build the destination file path."""
        return os.path.join(save_path, file_name) if save_path else file_name

    def _get_local_metadata_path(self, file_name: str, save_path: str | None = None) -> str:
        """Build the destination metadata path."""
        return f"{self._get_local_file_path(file_name, save_path)}.txt"

    def _load_saved_metadata(
        self,
        file_name: str,
        save_path: str | None = None,
    ) -> JSONDict | None:
        """Load previously saved metadata for a local file if present."""
        metadata_path = self._get_local_metadata_path(file_name, save_path)
        if not os.path.exists(metadata_path):
            return None
        try:
            with open(metadata_path, encoding="utf-8") as metadata_file:
                data = json.load(metadata_file)
            return data if isinstance(data, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

    def _build_local_name(self, file_obj: File, save_historically: bool) -> str:
        """Return the local file name, versioned by upload timestamp when requested.

        When *save_historically* is True the file's ``uploaded`` value is appended
        to the name in ``YYYYMMDDHHMMSS`` format, inserted before the extension
        (e.g. ``LLYN.B250_K01_F03_20260702000000.ifc``). Because the Dalux API
        reports ``uploaded`` with date granularity only (``yyyy-MM-dd``), the time
        portion is always zeros. Files uploaded the same day therefore share a
        timestamp and are distinguished by their revision id during the
        up-to-date check.
        """
        if not save_historically or file_obj.uploaded is None:
            return file_obj.file_name
        timestamp = file_obj.uploaded.strftime("%Y%m%d%H%M%S")
        root, ext = os.path.splitext(file_obj.file_name)
        return f"{root}_{timestamp}{ext}"

    def _download_file_with_metadata(
        self,
        file_obj: File,
        *,
        save_path: str | None,
        save_metadata: bool,
        save_historically: bool,
        progress_label: str,
        verbose: bool,
    ) -> File:
        """Download a single file (optionally versioned) and write its metadata.

        Skips the download when a matching local copy already exists (same
        ``file_revision_id`` and ``uploaded`` value). With *save_historically*
        enabled each revision is saved under its own timestamped name, so earlier
        downloads are preserved rather than overwritten and re-running only
        fetches revisions not yet present locally.

        Returns a :class:`File` copy with ``saved_file_path`` and
        ``saved_metadata_path`` populated.
        """
        return shared_download_file_with_metadata(
            file_obj,
            save_path=save_path,
            save_metadata=save_metadata,
            save_historically=save_historically,
            progress_label=progress_label,
            verbose=verbose,
            api_key=self._client._configuration.api_key,
        )

    @overload
    def list_files(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[File]: ...
    @overload
    def list_files(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> FilesListResponse | None: ...
    @overload
    def list_files(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_files(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "FilesListResponse | list[File] | pd.DataFrame | None":
        """GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files.

        See ``docs/official-api-docs/Dalux Build API.yaml`` (operationId: listFiles).
        Pass ``includeProperties=True`` in *params* to return each file's
        properties array. The files endpoint does not support OData ``$filter``.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full FilesListResponse
                (including metadata and links). If False (default), return
                just the list of File items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            List of File items, the full FilesListResponse when
            full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        response = self._client.get(
            f"/6.1/projects/{project_id}/file_areas/{file_area_id}/files",
            params=params,
        )
        result = convert_to_list_response(response, FilesListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_files(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        include_users: bool = False,
        include_companies: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[FileLike]: ...

    @overload
    def get_all_files(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        include_users: bool = False,
        include_companies: bool = False,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "pd.DataFrame": ...

    def get_all_files(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        include_users: bool = False,
        include_companies: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "list[FileLike] | pd.DataFrame":
        """Retrieve all files by following bookmark pagination automatically.

        Args:
            params: Optional additional query parameters.
            verbose: If True, print progress information.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas) instead of a list.
            include_users: If True, replace user_id fields with ProjectUser objects
                (requires one additional API call to fetch project users).
            include_companies: If True, replace company_id in ProjectUser objects
                with ProjectCompany objects (requires one additional API call).
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            List of all file items, as File objects where the payload
            validated cleanly and raw dicts otherwise; or a DataFrame when
            to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)

        if include_users:
            from .users import UsersApi

            users_api = UsersApi(self._client)
            users = users_api.list_project_users(project_id=project_id)
            user_mapping = create_user_mapping(users)
        else:
            user_mapping = None

        if include_companies:
            from .companies import CompaniesApi

            companies_api = CompaniesApi(self._client)
            companies = companies_api.list_project_companies(project_id=project_id)
            company_mapping = create_company_mapping(companies)
        else:
            company_mapping = None

        endpoint = f"/6.1/projects/{project_id}/file_areas/{file_area_id}/files"
        self._print_endpoint("GET", endpoint, params=params, verbose=verbose)
        raw_items = paginate(endpoint, self._client, params, verbose)

        # Convert raw items to File objects
        files: list[FileLike] = []
        for item in raw_items:
            if isinstance(item, dict) and "data" in item:
                file_data = item["data"]
                if user_mapping:
                    file_data = enrich_response_with_users(
                        file_data,
                        user_mapping,
                        {
                            "uploadedByUserId": "uploadedByUser",
                            "lastModifiedByUserId": "lastModifiedByUser",
                        },
                    )
                if company_mapping:
                    file_data = enrich_response_with_users(
                        file_data, company_mapping, {"companyId": "company"}
                    )
                try:
                    file_obj = File.model_validate(file_data)
                    files.append(file_obj)
                except Exception:
                    # If conversion fails, fall back to raw data for compatibility
                    if isinstance(file_data, dict):
                        files.append(file_data)
            elif isinstance(item, dict):
                files.append(item)

        if to_dataframe:
            return flatten_items_to_dataframe(list(files))
        return files

    @overload
    def get_all_files_in_folder(
        self,
        folder_id: str | None = None,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        path: str | None = None,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[FileLike]: ...
    @overload
    def get_all_files_in_folder(
        self,
        folder_id: str | None = None,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        path: str | None = None,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_files_in_folder(
        self,
        folder_id: str | None = None,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        path: str | None = None,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "list[FileLike] | pd.DataFrame":
        """Retrieve all files for a folder using either a folder ID or a full path.

        Supports either:
        - ``get_all_files_in_folder(folder_id, file_area_id=...)`` — file_area_id
          falls back to the client's configured default when omitted.
        - ``get_all_files_in_folder(path="Files/4_Design/C07_Geometry/C07.05_BIM")``

        Args:
            folder_id: The folder ID to filter files by. Required unless *path* is given.
            params: Optional additional query parameters passed to the API.
            verbose: If True, print progress information.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas) instead of a list.
            path: A full path starting with the file area name, such as
                ``"Files/4_Design/C07_Geometry/C07.05_BIM"``. Alternative to
                *folder_id* + *file_area_id*.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured
                default. Not used, and not backfilled from the client default,
                when *path* is given.

        Returns:
            A list of file items belonging to the specified folder, or a
            DataFrame when to_dataframe=True.

        Raises:
            ValueError: If neither *folder_id* nor *path* is provided.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)

        resolved_file_area_id: str
        resolved_folder_id: str
        if path is not None:
            maybe_file_area_id, maybe_folder_id = resolve_folder_id_from_named_path(
                self._client, project_id, path, verbose=verbose
            )
            if maybe_file_area_id is None or maybe_folder_id is None:
                if verbose:
                    print(f"Could not resolve folder path: {path}")
                return flatten_items_to_dataframe([]) if to_dataframe else []
            resolved_file_area_id = maybe_file_area_id
            resolved_folder_id = maybe_folder_id
        else:
            if folder_id is None:
                raise ValueError("either 'folder_id' or 'path' must be provided")
            resolved_file_area_id = resolve_file_area_id(
                file_area_id, self._client.configuration.file_area_id
            )
            resolved_folder_id = folder_id
            validate_folder_id(resolved_folder_id)

        all_files = self.get_all_files(
            params=params,
            verbose=verbose,
            project_id=project_id,
            file_area_id=resolved_file_area_id,
        )
        filtered = find_all_by_field(
            all_files, "folderId", resolved_folder_id, accessor=lambda x: x
        )
        if verbose:
            print(f"Files matching folder {resolved_folder_id!r}: {len(filtered)}")
        if to_dataframe:
            return flatten_items_to_dataframe(list(filtered))
        return filtered

    def _extract_file_name(self, file_item: FileLike) -> str:
        """Extract a file name from either a File model or raw API item."""
        if isinstance(file_item, File):
            return file_item.file_name or ""
        data = file_item.get("data")
        if isinstance(data, dict):
            name = data.get("fileName", "")
            return name if isinstance(name, str) else ""
        name = file_item.get("fileName", "")
        return name if isinstance(name, str) else ""

    def _coerce_file(self, file_item: FileLike) -> File | None:
        """Convert a raw file item to a File model when possible."""
        if isinstance(file_item, File):
            return file_item
        file_data = file_item.get("data", file_item)
        if isinstance(file_data, dict):
            try:
                return File.model_validate(file_data)
            except Exception:
                return None
        return None

    def _looks_like_path(self, value: str) -> bool:
        """Return True when the given value looks like a slash-delimited file path."""
        normalized = value.strip().replace("\\", "/")
        return "/" in normalized.strip("/")

    def bulk_download_folder(
        self,
        folder_id: str | None = None,
        save_path: str | None = None,
        save_metadata: bool = False,
        save_historically: bool = False,
        filters: FileNameFilter | None = None,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        path: str | None = None,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[File]:
        """Download all files in a folder with optional case-insensitive name filters.

        Supports either:
        - ``bulk_download_folder(folder_id, file_area_id=...)`` — file_area_id
          falls back to the client's configured default when omitted.
        - ``bulk_download_folder(path="Files/4_Design/C07_Geometry/C07.05_BIM")``

        Args:
            folder_id: The folder ID to download files from. Required unless *path* is given.
            save_path: Optional directory to save downloaded files. Defaults to current directory.
            save_metadata: If True, write ``model_dump()`` metadata for each downloaded
                file to a sibling ``.txt`` file.
            save_historically: If True, append the file's ``uploaded`` timestamp
                (``YYYYMMDDHHMMSS``) to each downloaded file and its metadata so
                earlier revisions are kept side by side instead of overwritten.
                Re-running only downloads revisions not already present locally.
            filters: Optional :class:`FileNameFilter` with include/exclude rules for
                fileName matching.
            params: Optional additional query parameters passed to the API.
            verbose: If True, print progress information.
            path: A full folder path starting with the file area name, such as
                ``"Files/4_Design/C07_Geometry/C07.05_BIM"``. Alternative to
                *folder_id* + *file_area_id*.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured
                default. Not used, and not backfilled from the client default,
                when *path* is given.

        Returns:
            List of downloaded :class:`File` objects with ``saved_file_path`` and
            optionally ``saved_metadata_path`` populated.
        """
        files = self.get_all_files_in_folder(
            folder_id,
            params=params,
            verbose=verbose,
            path=path,
            project_id=project_id,
            file_area_id=file_area_id,
        )

        resolved_filters = filters.model_copy(deep=True) if filters else FileNameFilter()

        filtered = filter_files_by_name(
            files,
            resolved_filters,
            name_getter=self._extract_file_name,
            verbose=verbose,
        )

        results: list[File] = []
        for i, f in enumerate(filtered, 1):
            file_obj = self._coerce_file(f)
            file_name = (
                file_obj.file_name if file_obj else self._extract_file_name(f) or f"file_{i}"
            )

            if not file_obj or not file_obj.download_link:
                if verbose:
                    print(f"  [{i}/{len(filtered)}] Skipping {file_name!r} (no downloadLink)")
                continue

            results.append(
                self._download_file_with_metadata(
                    file_obj,
                    save_path=save_path,
                    save_metadata=save_metadata,
                    save_historically=save_historically,
                    progress_label=f"[{i}/{len(filtered)}]",
                    verbose=verbose,
                )
            )

        if verbose:
            print(f"Bulk download complete. {len(results)}/{len(filtered)} file(s) downloaded.")
        return results

    def bulk_download_files(
        self,
        files: list[str],
        file_area_id: str | None = None,
        save_path: str | None = None,
        save_metadata: bool = False,
        save_historically: bool = False,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[File]:
        """Download a list of files by IDs or full paths.

        Args:
            files: List of file IDs or full file paths.
            file_area_id: Optional file area ID for file ID lookups. If omitted,
                ID lookups use the client's configured default file area. Path
                lookups (e.g. ``Files/folder/.../file.ext``) resolve file area
                from the path itself.
            save_path: Optional directory to save files. Defaults to current directory.
            save_metadata: If True, write ``model_dump()`` metadata for each downloaded
                file to a sibling ``.txt`` file.
            save_historically: If True, append the file's ``uploaded`` timestamp
                (``YYYYMMDDHHMMSS``) to each downloaded file and its metadata so
                earlier revisions are kept side by side instead of overwritten.
                Re-running only downloads revisions not already present locally.
            params: Optional additional query parameters used for path-based resolution.
            verbose: If True, print progress per file.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of downloaded :class:`File` objects with ``saved_file_path`` and
            optionally ``saved_metadata_path`` populated.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        results: list[File] = []
        file_areas_cache: dict[str, FileArea] = {}
        folders_cache: dict[str, list[FolderLike]] = {}
        resolved_paths_cache: dict[str, tuple[str | None, str | None]] = {}
        all_files_cache: dict[str, list[FileLike]] = {}
        total = len(files)
        resolved_file_area_id_for_ids: str | None = None
        for i, item in enumerate(files, 1):
            normalized_item = item.strip()
            if self._looks_like_path(normalized_item):
                normalized_path = normalized_item.replace("\\", "/")
                path_parts = [
                    part.strip() for part in normalized_path.strip("/").split("/") if part.strip()
                ]
                if len(path_parts) < 3:
                    if verbose:
                        print(f"  [{i}/{total}] Skipping {normalized_item!r} (invalid path)")
                    continue

                resolved_file_area_id, folder_id = resolve_folder_id_from_named_path(
                    self._client,
                    project_id,
                    "/".join(path_parts[:-1]),
                    verbose=verbose,
                    file_areas_cache=file_areas_cache,
                    folders_cache=folders_cache,
                    resolved_paths_cache=resolved_paths_cache,
                )
                if not resolved_file_area_id or not folder_id:
                    if verbose:
                        print(
                            f"  [{i}/{total}] Skipping {normalized_item!r} "
                            f"(File does not exist: {normalized_item})"
                        )
                    continue
                if resolved_file_area_id not in all_files_cache:
                    all_files_cache[resolved_file_area_id] = self.get_all_files(
                        params=params,
                        verbose=verbose,
                        project_id=project_id,
                        file_area_id=resolved_file_area_id,
                    )
                folder_files = find_all_by_field(
                    all_files_cache[resolved_file_area_id],
                    "folderId",
                    folder_id,
                    accessor=lambda x: x,
                )
                if verbose:
                    print(f"Files matching folder {folder_id!r}: {len(folder_files)}")
                file_match = find_by_field(folder_files, "file_name", path_parts[-1])
                if not file_match:
                    if verbose:
                        print(
                            f"  [{i}/{total}] Skipping {normalized_item!r} "
                            f"(File does not exist: {normalized_item})"
                        )
                    continue
                file_obj = self._coerce_file(file_match)
            else:
                if resolved_file_area_id_for_ids is None:
                    resolved_file_area_id_for_ids = resolve_file_area_id(
                        file_area_id, self._client.configuration.file_area_id
                    )
                file_info = self.get_file(
                    normalized_item,
                    verbose=verbose,
                    project_id=project_id,
                    file_area_id=resolved_file_area_id_for_ids,
                )
                if isinstance(file_info, str):
                    if verbose:
                        print(f"  [{i}/{total}] Skipping {normalized_item!r} ({file_info})")
                    continue
                if isinstance(file_info, FileResponse):
                    file_obj = file_info.data
                elif isinstance(file_info, File):
                    file_obj = file_info
                else:
                    file_obj = None

            if not file_obj or not file_obj.download_link:
                if verbose:
                    file_name = file_obj.file_name if file_obj else normalized_item
                    print(f"  [{i}/{total}] Skipping {file_name!r} (no downloadLink)")
                continue

            results.append(
                self._download_file_with_metadata(
                    file_obj,
                    save_path=save_path,
                    save_metadata=save_metadata,
                    save_historically=save_historically,
                    progress_label=f"[{i}/{total}]",
                    verbose=verbose,
                )
            )
        if verbose:
            print(f"Done. {len(results)}/{total} file(s) downloaded.")
        return results

    def get_file(
        self,
        file_id: str | None = None,
        download: bool = False,
        save_path: str | None = None,
        params: QueryParams | None = None,
        verbose: bool = False,
        include_users: bool = False,
        include_companies: bool = False,
        *,
        path: str | None = None,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> FileResponse | FileLike | str | None:
        """Get a file either by ID or by full path.

        Supports either:
        - ``get_file(file_id, file_area_id=...)`` — file_area_id falls back to
          the client's configured default when omitted.
        - ``get_file(path="Files/folder/.../file.ext")``

        If ``download=True``, also downloads the file using the file's download link.

        Args:
            file_id: File ID to look up. Required unless *path* is given.
            download: If True, download the file content using the download link.
            save_path: Optional directory to save the file (default: current directory).
            params: Optional additional query parameters used for path-based resolution.
            verbose: If True, print progress information for path-based resolution.
            include_users: If True, replace user_id fields with ProjectUser objects
                (requires one additional API call to fetch project users).
            include_companies: If True, replace company_id in ProjectUser objects
                with ProjectCompany objects (requires one additional API call).
            path: A full path starting with the file area name, e.g.
                ``"Files/folder/.../file.ext"``. Alternative to *file_id* +
                *file_area_id*.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured
                default. Not used, and not backfilled from the client default,
                when *path* is given.

        Returns:
            FileResponse for ID lookups, File for path lookups, or a not-found message.
            If ``download=True``, returns a dict with ``downloaded_file_path`` added.

        Raises:
            ValueError: If neither *file_id* nor *path* is provided.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)

        if path is not None:
            not_found_message = f"File does not exist: {path}"
            path_parts = [part.strip() for part in path.strip("/").split("/") if part.strip()]
            if len(path_parts) < 3:
                raise ValueError("path must include file area name, folder path, and file name")

            resolved_file_area_id, folder_id = resolve_folder_id_from_named_path(
                self._client, project_id, "/".join(path_parts[:-1]), verbose=verbose
            )
            if not resolved_file_area_id or not folder_id:
                return not_found_message

            candidate_file_name = path_parts[-1]
            files = self.get_all_files_in_folder(
                folder_id,
                params=params,
                verbose=verbose,
                project_id=project_id,
                file_area_id=resolved_file_area_id,
            )
            file_match = find_by_field(files, "file_name", candidate_file_name)
            if not file_match:
                return not_found_message

            if download and isinstance(file_match, File) and file_match.download_link:
                result: JSONDict = file_match.model_dump()
                result["downloaded_file_path"] = self._download_file_from_link(
                    file_match.download_link, file_match.file_name, save_path, verbose=verbose
                )
                return result
            return file_match

        if file_id is None:
            raise ValueError("either 'file_id' or 'path' must be provided")

        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        self._print_endpoint(
            "GET",
            f"/5.0/projects/{project_id}/file_areas/{file_area_id}/files/{file_id}",
            verbose=verbose,
        )
        response = self._client.get(
            f"/5.0/projects/{project_id}/file_areas/{file_area_id}/files/{file_id}"
        )

        if include_users and isinstance(response, dict):
            from .users import UsersApi

            users_api = UsersApi(self._client)
            users = users_api.list_project_users(project_id=project_id)
            user_mapping = create_user_mapping(users)
            response = enrich_response_with_users(
                response,
                user_mapping,
                {
                    "uploadedByUserId": "uploadedByUser",
                    "lastModifiedByUserId": "lastModifiedByUser",
                },
            )

        if include_companies and isinstance(response, dict):
            from .companies import CompaniesApi

            companies_api = CompaniesApi(self._client)
            companies = companies_api.list_project_companies(project_id=project_id)
            company_mapping = create_company_mapping(companies)
            response = enrich_response_with_users(
                response, company_mapping, {"companyId": "company"}
            )

        file_info = convert_to_model(response, FileResponse)

        if download and file_info:
            download_link = file_info.data.download_link if file_info.data else None
            file_name = (file_info.data.file_name if file_info.data else file_id) or file_id

            if download_link:
                downloaded_path = self._download_file_from_link(
                    download_link, file_name, save_path, verbose=verbose
                )
                id_result: JSONDict = file_info.model_dump()
                id_result["downloaded_file_path"] = downloaded_path
                return id_result

        return file_info

    def download_file_from_link(
        self,
        download_link: str,
        file_name: str,
        save_path: str | None = None,
        verbose: bool = False,
    ) -> str:
        """Public entry point for downloading a file from its direct download link.

        See :meth:`_download_file_from_link` for details.
        """
        return self._download_file_from_link(download_link, file_name, save_path, verbose=verbose)

    def _download_file_from_link(
        self,
        download_link: str,
        file_name: str,
        save_path: str | None = None,
        verbose: bool = False,
    ) -> str:
        """Download a file from a direct download link using the API key.

        Args:
            download_link: The direct download URL for the file content.
            file_name: The name to save the file as.
            save_path: Optional directory to save the file. Defaults to current directory.

        Returns:
            The full path to the saved file.

        Raises:
            Exception: If the download fails.
        """
        if save_path:
            os.makedirs(save_path, exist_ok=True)
            file_path = os.path.join(save_path, file_name)
        else:
            file_path = file_name
        temp_file_path = f"{file_path}.part"

        api_key = self._client._configuration.api_key
        headers = {"X-API-KEY": api_key}

        response = requests.get(download_link, headers=headers, stream=True)
        if verbose:
            print(f"GET {download_link}")
        if response.status_code == 200:
            total_bytes_header = response.headers.get("Content-Length")
            total_bytes = (
                int(total_bytes_header)
                if total_bytes_header and total_bytes_header.isdigit()
                else None
            )
            progress: _ProgressBar | None = None
            if verbose and tqdm is not None:
                progress = tqdm(
                    total=total_bytes,
                    unit="B",
                    unit_scale=True,
                    unit_divisor=1000,
                    desc=file_name,
                    leave=False,
                )
            with open(temp_file_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        if progress is not None:
                            progress.update(len(chunk))
                f.flush()
                os.fsync(f.fileno())
            if progress is not None:
                progress.close()
            os.replace(temp_file_path, file_path)
            return file_path
        else:
            raise Exception(f"Failed to download file. Status code: {response.status_code}")

    def select_files_interactive(
        self,
        tree: "TreeNode | None" = None,
        folders_api: "FoldersApi | None" = None,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[str]:
        """Interactively browse the folder tree level-by-level and select files.

        Navigation works like a simple file browser:
        - Type a **folder number** (single token) to enter that folder.
        - Type ``b`` (or ``back``) to go up one level.
        - Type **file numbers / ranges** to toggle selection (``✓`` marks selected files).
        - Type ``d`` (or ``done``) to finish and return the selected file IDs.
        - Empty folders are hidden; folders and files are sorted alphabetically.

        Args:
            tree: Pre-built tree from :meth:`FoldersApi.get_file_area_tree`.
                If not provided, *folders_api* must be supplied so the tree
                can be built automatically (files are fetched in parallel).
            folders_api: :class:`FoldersApi` instance used to build the tree
                when *tree* is ``None``.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            Ordered list of selected file IDs (in order they were selected).

        Raises:
            ValueError: If neither *tree* nor *folders_api* is provided.
        """
        if tree is None:
            if folders_api is None:
                raise ValueError("Either 'tree' or 'folders_api' must be provided.")
            project_id = resolve_project_id(project_id, self._client.configuration.project_id)
            file_area_id = resolve_file_area_id(
                file_area_id, self._client.configuration.file_area_id
            )
            tree = folders_api.get_file_area_tree(
                files_api=self, project_id=project_id, file_area_id=file_area_id
            )

        # ------------------------------------------------------------------ helpers
        def _fid(f: object) -> str | None:
            data = f.get("data") if isinstance(f, dict) else None
            fid = (data or {}).get("id") or (data or {}).get("fileId") if data else None
            return fid if isinstance(fid, str) else None

        def _fname(f: object) -> str:
            data = f.get("data") if isinstance(f, dict) else None
            name = (data or {}).get("fileName", "<unknown>") if data else "<unknown>"
            return name if isinstance(name, str) else "<unknown>"

        def _has_content(node: "TreeNode") -> bool:
            if node["files"]:
                return True
            return any(_has_content(c) for c in node["children"])

        def _count_files(node: "TreeNode") -> int:
            return len(node["files"]) + sum(_count_files(c) for c in node["children"])

        def _parse_tokens(raw: str, max_idx: int) -> set[int]:
            chosen: set[int] = set()
            for token in raw.split():
                if "-" in token:
                    parts = token.split("-", 1)
                    try:
                        lo, hi = int(parts[0]), int(parts[1])
                        chosen.update(range(lo, hi + 1))
                    except ValueError:
                        pass
                else:
                    try:
                        chosen.add(int(token))
                    except ValueError:
                        pass
            return {i for i in chosen if 1 <= i <= max_idx}

        # ------------------------------------------------------------------ state
        selected_ids: list[str] = []
        selected_set: set[str] = set()
        stack: list[TreeNode] = [tree]

        while True:
            node = stack[-1]

            # sort folders and files alphabetically; hide empty folders
            folders = sorted(
                [c for c in node["children"] if _has_content(c)],
                key=lambda c: c["name"].lower(),
            )
            files = sorted(node["files"], key=lambda f: _fname(f).lower())

            # ---- render screen ----
            print()
            header = node["path"] if node["path"] else f"[root]  {node['name']}"
            print(f"  {'=' * 60}")
            print(f"  {header}")
            print(f"  {'=' * 60}")
            nav_hints = []
            if len(stack) > 1:
                nav_hints.append("[b] back")
            nav_hints.append(f"[d] done  ({len(selected_ids)} selected)")
            print(f"  {' | '.join(nav_hints)}")

            if folders:
                print()
                print("  Folders:")
                for i, child in enumerate(folders, 1):
                    total = _count_files(child)
                    print(f"    [{i:>3}]  {child['name']}/  ({total} file(s))")
            else:
                print("\n  Folders: (none)")

            file_offset = len(folders)
            if files:
                print()
                print("  Files:")
                for j, f in enumerate(files, 1):
                    idx = file_offset + j
                    mark = "✓ " if _fid(f) in selected_set else "  "
                    print(f"    [{idx:>3}]  {mark}{_fname(f)}")
            else:
                print("\n  Files: (none)")

            print()
            print("  > ", end="", flush=True)
            raw = input().strip()
            cmd = raw.lower()

            # ---- commands ----
            if cmd in ("d", "done", ""):
                if cmd in ("d", "done"):
                    break
                continue  # empty input – redraw

            if cmd in ("b", "back"):
                if len(stack) > 1:
                    stack.pop()
                continue

            # ---- single folder number → navigate ----
            tokens = raw.split()
            if len(tokens) == 1 and tokens[0].isdigit():
                idx = int(tokens[0])
                if 1 <= idx <= len(folders):
                    stack.append(folders[idx - 1])
                    continue
                # fall through if it's a file index

            # ---- file number(s) / ranges → toggle selection ----
            chosen = _parse_tokens(raw, file_offset + len(files))
            toggled = 0
            for idx in sorted(chosen):
                if idx <= len(folders):
                    continue  # skip folder indices in multi-token input
                file_idx = idx - file_offset - 1
                if 0 <= file_idx < len(files):
                    f = files[file_idx]
                    fid = _fid(f)
                    if fid is None:
                        continue
                    if fid in selected_set:
                        selected_set.discard(fid)
                        selected_ids = [i for i in selected_ids if i != fid]
                    else:
                        selected_set.add(fid)
                        selected_ids.append(fid)
                    toggled += 1
            if toggled:
                print(f"  → {len(selected_ids)} file(s) selected total.")

        print(f"\n  Done. {len(selected_ids)} file(s) selected.")
        return selected_ids

    def get_file_properties_mapping(
        self,
        file_id: str,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> JSONValue | None:
        """GET .../files/{fileId}/properties/1.0/mappings."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        return self._client.get(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}"
            f"/files/{file_id}/properties/1.0/mappings"
        )

    def get_file_property_mapping_values(
        self,
        file_property_id: str,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> JSONValue | None:
        """GET .../files/properties/1.0/mappings/{filePropertyId}/values."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        return self._client.get(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}"
            f"/files/properties/1.0/mappings/{file_property_id}/values"
        )
