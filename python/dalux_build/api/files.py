"""Files API."""

import json
import os
from typing import TYPE_CHECKING, Literal, Protocol, overload

import requests

from ..api_client import ApiClient
from ..json_types import JSONDict, JSONValue, QueryParams
from ..models import File, FileArea, FileNameFilter, FileResponse, FilesListResponse
from ..response_converter import (
    convert_to_list_response,
    convert_to_model,
    flatten_items_to_dataframe,
    to_dataframe_or_empty,
)
from ..utils.pagination import paginate
from ..utils.path_resolver import resolve_folder_id_from_named_path
from ..utils.search import find_all_by_field, find_by_field
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


class FilesApi:
    """Methods for files within a file area."""

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
        local_name = self._build_local_name(file_obj, save_historically)
        local_file_path = self._get_local_file_path(local_name, save_path)
        metadata_path = self._get_local_metadata_path(local_name, save_path)
        current_metadata = file_obj.model_dump(mode="json")
        saved_metadata = self._load_saved_metadata(local_name, save_path)
        if (
            saved_metadata
            and os.path.exists(local_file_path)
            and saved_metadata.get("file_revision_id") == current_metadata.get("file_revision_id")
            and saved_metadata.get("uploaded") == current_metadata.get("uploaded")
        ):
            print(f"  {progress_label} {local_name!r} is still up-to-date. Skipping download.")
            return file_obj.model_copy(
                update={
                    "saved_file_path": local_file_path,
                    "saved_metadata_path": metadata_path,
                }
            )

        if verbose:
            print(f"  {progress_label} Downloading {local_name!r}...")
        assert file_obj.download_link is not None, "caller must check download_link first"
        downloaded_path = self._download_file_from_link(
            file_obj.download_link,
            local_name,
            save_path,
            verbose=verbose,
        )
        written_metadata_path = None
        if save_metadata:
            written_metadata_path = self._get_local_metadata_path(local_name, save_path)
            with open(written_metadata_path, "w", encoding="utf-8") as metadata_file:
                json.dump(current_metadata, metadata_file, indent=2)
                metadata_file.flush()
                os.fsync(metadata_file.fileno())

        return file_obj.model_copy(
            update={
                "saved_file_path": downloaded_path,
                "saved_metadata_path": written_metadata_path,
            }
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
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_files(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
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
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            List of all file items, as File objects where the payload
            validated cleanly and raw dicts otherwise; or a DataFrame when
            to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)

        endpoint = f"/6.1/projects/{project_id}/file_areas/{file_area_id}/files"
        self._print_endpoint("GET", endpoint, params=params, verbose=verbose)
        raw_items = paginate(endpoint, self._client, params, verbose)

        # Convert raw items to File objects
        files: list[FileLike] = []
        for item in raw_items:
            if isinstance(item, dict) and "data" in item:
                file_data = item["data"]
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

    def _normalize_extensions(self, extensions: list[str]) -> list[str]:
        """Normalize file extensions to lower-case values prefixed with a dot."""
        return [(ext if ext.startswith(".") else f".{ext}").lower() for ext in extensions if ext]

    def _apply_file_name_filters(
        self,
        files: list[FileLike],
        *,
        contains: list[str] | None = None,
        contains_match: str = "any",
        not_contains: list[str] | None = None,
        startswith: list[str] | None = None,
        not_startswith: list[str] | None = None,
        endswith: list[str] | None = None,
        not_endswith: list[str] | None = None,
        extensions: list[str] | None = None,
        not_extensions: list[str] | None = None,
        verbose: bool = False,
    ) -> list[FileLike]:
        """Filter files by file name using case-insensitive include/exclude rules."""
        filtered = files

        def lowered_values(values: list[str] | None) -> list[str]:
            return [value.lower() for value in values or [] if value]

        contains_values = lowered_values(contains)
        not_contains_values = lowered_values(not_contains)
        startswith_values = lowered_values(startswith)
        not_startswith_values = lowered_values(not_startswith)
        endswith_values = lowered_values(endswith)
        not_endswith_values = lowered_values(not_endswith)
        extension_values = self._normalize_extensions(extensions or [])
        not_extension_values = self._normalize_extensions(not_extensions or [])

        def file_name(file_item: FileLike) -> str:
            return self._extract_file_name(file_item).lower()

        if contains_values:
            before = len(filtered)
            if contains_match == "all":
                filtered = [
                    file_item
                    for file_item in filtered
                    if all(value in file_name(file_item) for value in contains_values)
                ]
            else:
                filtered = [
                    file_item
                    for file_item in filtered
                    if any(value in file_name(file_item) for value in contains_values)
                ]
            if verbose:
                print(
                    f"Files matching fileName contains {contains_values} "
                    f"({contains_match}): {len(filtered)} / {before}"
                )

        if not_contains_values:
            before = len(filtered)
            filtered = [
                file_item
                for file_item in filtered
                if not any(value in file_name(file_item) for value in not_contains_values)
            ]
            if verbose:
                print(
                    f"Files excluding fileName contains {not_contains_values}: "
                    f"{len(filtered)} / {before}"
                )

        if startswith_values:
            before = len(filtered)
            filtered = [
                file_item
                for file_item in filtered
                if any(file_name(file_item).startswith(value) for value in startswith_values)
            ]
            if verbose:
                print(
                    f"Files matching fileName startswith {startswith_values}: "
                    f"{len(filtered)} / {before}"
                )

        if not_startswith_values:
            before = len(filtered)
            filtered = [
                file_item
                for file_item in filtered
                if not any(
                    file_name(file_item).startswith(value) for value in not_startswith_values
                )
            ]
            if verbose:
                print(
                    f"Files excluding fileName startswith {not_startswith_values}: "
                    f"{len(filtered)} / {before}"
                )

        if endswith_values:
            before = len(filtered)
            filtered = [
                file_item
                for file_item in filtered
                if any(file_name(file_item).endswith(value) for value in endswith_values)
            ]
            if verbose:
                print(
                    f"Files matching fileName endswith {endswith_values}: "
                    f"{len(filtered)} / {before}"
                )

        if not_endswith_values:
            before = len(filtered)
            filtered = [
                file_item
                for file_item in filtered
                if not any(file_name(file_item).endswith(value) for value in not_endswith_values)
            ]
            if verbose:
                print(
                    f"Files excluding fileName endswith {not_endswith_values}: "
                    f"{len(filtered)} / {before}"
                )

        if extension_values:
            before = len(filtered)
            filtered = [
                file_item
                for file_item in filtered
                if any(file_name(file_item).endswith(ext) for ext in extension_values)
            ]
            if verbose:
                print(
                    f"Files matching fileName extensions {extension_values}: "
                    f"{len(filtered)} / {before}"
                )

        if not_extension_values:
            before = len(filtered)
            filtered = [
                file_item
                for file_item in filtered
                if not any(file_name(file_item).endswith(ext) for ext in not_extension_values)
            ]
            if verbose:
                print(
                    f"Files excluding fileName extensions {not_extension_values}: "
                    f"{len(filtered)} / {before}"
                )

        return filtered

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

        filtered = self._apply_file_name_filters(
            files,
            contains=resolved_filters.contains,
            contains_match=resolved_filters.contains_match,
            not_contains=resolved_filters.not_contains,
            startswith=resolved_filters.startswith,
            not_startswith=resolved_filters.not_startswith,
            endswith=resolved_filters.endswith,
            not_endswith=resolved_filters.not_endswith,
            extensions=resolved_filters.extensions,
            not_extensions=resolved_filters.not_extensions,
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
            file_area_id: File area ID when *files* contains file IDs. Leave unset
                when *files* contains full paths like
                ``Files/folder/.../file.ext`` — ``None`` here specifically selects
                path-based resolution and is *not* backfilled from the client's
                configured default file area.
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
        for i, item in enumerate(files, 1):
            if file_area_id is None:
                path_parts = [part.strip() for part in item.strip("/").split("/") if part.strip()]
                if len(path_parts) < 3:
                    if verbose:
                        print(f"  [{i}/{total}] Skipping {item!r} (invalid path)")
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
                        print(f"  [{i}/{total}] Skipping {item!r} (File does not exist: {item})")
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
                        print(f"  [{i}/{total}] Skipping {item!r} (File does not exist: {item})")
                    continue
                file_obj = self._coerce_file(file_match)
            else:
                file_info = self.get_file(
                    item,
                    verbose=verbose,
                    project_id=project_id,
                    file_area_id=file_area_id,
                )
                if isinstance(file_info, str):
                    if verbose:
                        print(f"  [{i}/{total}] Skipping {item!r} ({file_info})")
                    continue
                if isinstance(file_info, FileResponse):
                    file_obj = file_info.data
                elif isinstance(file_info, File):
                    file_obj = file_info
                else:
                    file_obj = None

            if not file_obj or not file_obj.download_link:
                if verbose:
                    file_name = file_obj.file_name if file_obj else item
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
