"""Version Sets API."""

import fnmatch
import re
from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import QueryParams
from ..models import (
    DownloadResult,
    File,
    FileNameFilter,
    FilesListResponse,
    MissingFileReport,
    VersionSet,
    VersionSetResponse,
    VersionSetsListResponse,
)
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.download import download_file_with_metadata
from ..utils.file_filter import matches_file_name_filter
from ..utils.validation import resolve_file_area_id, resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class VersionSetsApi(DashboardApiMixin):
    """Methods for version sets."""

    dashboard_resource = "version_sets"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def get_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[VersionSet]: ...
    @overload
    def get_version_sets(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> VersionSetsListResponse | None: ...
    @overload
    def get_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "VersionSetsListResponse | list[VersionSet] | pd.DataFrame | None":
        """GET /2.1/projects/{projectId}/version_sets.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full VersionSetsListResponse
                (including metadata and links). If False (default), return
                just the list of VersionSet items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of VersionSet items, the full VersionSetsListResponse
            when full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/2.1/projects/{project_id}/version_sets", params=params)
        result = convert_to_list_response(response, VersionSetsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_version_set(
        self, version_set_id: str, *, project_id: str | None = None
    ) -> VersionSetResponse | None:
        """GET /2.0/projects/{projectId}/version_sets/{versionSetId}.

        Returns:
            VersionSetResponse with version set details.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/2.0/projects/{project_id}/version_sets/{version_set_id}")
        return convert_to_model(response, VersionSetResponse)

    @overload
    def list_file_area_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[VersionSet]: ...
    @overload
    def list_file_area_version_sets(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> VersionSetsListResponse | None: ...
    @overload
    def list_file_area_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_file_area_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "VersionSetsListResponse | list[VersionSet] | pd.DataFrame | None":
        """GET /2.1/projects/{projectId}/file_areas/{fileAreaId}/version_sets.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full VersionSetsListResponse
                (including metadata and links). If False (default), return
                just the list of VersionSet items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            List of VersionSet items, the full VersionSetsListResponse
            when full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        response = self._client.get(
            f"/2.1/projects/{project_id}/file_areas/{file_area_id}/version_sets",
            params=params,
        )
        result = convert_to_list_response(response, VersionSetsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def list_version_set_files(
        self,
        version_set_id: str,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[File]: ...
    @overload
    def list_version_set_files(
        self,
        version_set_id: str,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> FilesListResponse | None: ...
    @overload
    def list_version_set_files(
        self,
        version_set_id: str,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_version_set_files(
        self,
        version_set_id: str,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "FilesListResponse | list[File] | pd.DataFrame | None":
        """GET /3.0/projects/{projectId}/version_sets/{versionSetId}/files.

        Args:
            version_set_id: Version set ID.
            params: Optional query parameters.
            full_response: If True, return the full FilesListResponse
                (including metadata and links). If False (default), return
                just the list of File items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of File items, the full FilesListResponse when
            full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/3.0/projects/{project_id}/version_sets/{version_set_id}/files",
            params=params,
        )
        result = convert_to_list_response(response, FilesListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def _matches_file(self, file_obj: File, identifier: str | FileNameFilter) -> bool:
        """Check if a file matches an identifier (file_id, file_name, or filter pattern)."""
        if isinstance(identifier, FileNameFilter):
            return matches_file_name_filter(file_obj.file_name, identifier)

        # String identifier - try different matching strategies
        if identifier.startswith("S") and identifier[1:].isdigit():
            # Looks like a file_id
            return file_obj.file_id == identifier

        # Try exact file_name match
        if file_obj.file_name == identifier:
            return True

        # Try wildcard match
        if fnmatch.fnmatchcase(file_obj.file_name, identifier):
            return True

        # Try regex match
        try:
            if re.search(identifier, file_obj.file_name, re.IGNORECASE):
                return True
        except re.error:
            pass

        return False

    def download_files(
        self,
        identifiers: list[str | FileNameFilter],
        *,
        version_set_ids: list[str] | None = None,
        save_path: str | None = None,
        save_metadata: bool = False,
        verbose: bool = False,
        project_id: str | None = None,
    ) -> DownloadResult:
        """Download files matching identifiers from version sets.

        When version_set_ids is None, downloads from ALL version sets in the project.
        Always saves files with upload date appended to filename to prevent overwrites.

        Args:
            identifiers: List of file IDs, file names, wildcard patterns, regex patterns,
                or FileNameFilter objects to match files.
            version_set_ids: Specific version sets to search, or None for all version sets
                in the project.
            save_path: Optional directory to save files. Defaults to current directory.
            save_metadata: If True, write ``model_dump()`` metadata for each downloaded
                file to a sibling ``.txt`` file.
            verbose: If True, print progress information.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            DownloadResult with:
            - downloaded_files: Files successfully downloaded
            - skipped_files: Files skipped (already downloaded or no download link)
            - failed_files: Files that failed to download with error messages
            - missing_report: Dict mapping version_set_id -> MissingFileReport
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)

        # Step 1: Resolve version sets to check
        if version_set_ids is None:
            all_version_sets = self.get_version_sets(project_id=project_id)
            version_set_ids_to_check = [vs.version_set_id for vs in all_version_sets]
        else:
            version_set_ids_to_check = version_set_ids

        if verbose:
            print(f"Checking {len(version_set_ids_to_check)} version set(s)")

        # Initialize tracking structures
        downloaded: list[File] = []
        skipped: list[File] = []
        failed: list[tuple[File, str]] = []
        missing_report: dict[str, MissingFileReport] = {}

        # Step 2: Process each version set
        for vs_id in version_set_ids_to_check:
            if verbose:
                print(f"Processing version set: {vs_id}")

            # Get files for this version set
            vs_files = self.list_version_set_files(vs_id, project_id=project_id)

            # Initialize report for this version set
            missing_report[vs_id] = MissingFileReport(
                version_set_id=vs_id,
                missing_files=[],
                missing_download_links=[],
            )

            # Step 3: For each identifier, find matching files
            matched_files: list[tuple[str | FileNameFilter, File]] = []
            found_identifier_indexes: set[int] = set()

            for idx, ident in enumerate(identifiers):
                for f in vs_files:
                    if self._matches_file(f, ident):
                        matched_files.append((ident, f))
                        found_identifier_indexes.add(idx)

            # Step 4: Identify missing files (identifiers not found)
            for idx, ident in enumerate(identifiers):
                if idx not in found_identifier_indexes:
                    if isinstance(ident, FileNameFilter):
                        ident_str = f"filter:{id(ident)}"
                    else:
                        ident_str = str(ident)
                    missing_report[vs_id].missing_files.append(ident_str)

            # Step 5: Identify files without download links
            for _ident, f in matched_files:
                if not f.download_link:
                    if isinstance(_ident, FileNameFilter):
                        ident_str = f"filter:{id(_ident)}"
                    else:
                        ident_str = str(_ident)
                    if ident_str not in missing_report[vs_id].missing_download_links:
                        missing_report[vs_id].missing_download_links.append(ident_str)

            # Step 6: Download matched files
            for _ident, f in matched_files:
                if not f.download_link:
                    if verbose:
                        print(f"  Skipping {f.file_name!r} (no download link)")
                    skipped.append(f)
                    continue

                try:
                    result = download_file_with_metadata(
                        f,
                        save_path=save_path,
                        save_metadata=save_metadata,
                        save_historically=True,  # Always True for version sets
                        progress_label=f"[{vs_id}]",
                        verbose=verbose,
                        api_key=self._client._configuration.api_key,
                    )
                    downloaded.append(result)
                except Exception as e:
                    failed.append((f, str(e)))
                    if verbose:
                        print(f"  Failed to download {f.file_name!r}: {e}")

        return DownloadResult(
            downloaded_files=downloaded,
            skipped_files=skipped,
            failed_files=failed,
            missing_report=missing_report,
        )

    def get_files_missing_from_version_sets(
        self,
        identifiers: list[str | FileNameFilter],
        version_set_ids: list[str],
        *,
        project_id: str | None = None,
    ) -> dict[str, MissingFileReport]:
        """Check which files are missing from specified version sets.

        This method only checks for file existence and download link availability
        without actually downloading any files.

        Args:
            identifiers: List of file IDs, file names, wildcard patterns, regex patterns,
                or FileNameFilter objects to look for.
            version_set_ids: Version sets to check for missing files.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            Dict mapping version_set_id -> MissingFileReport with:
            - missing_files: Identifiers that don't match any files in the version set
            - missing_download_links: Identifiers that match files but lack download links
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)

        missing_report: dict[str, MissingFileReport] = {}

        for vs_id in version_set_ids:
            vs_files = self.list_version_set_files(vs_id, project_id=project_id)

            missing_report[vs_id] = MissingFileReport(
                version_set_id=vs_id,
                missing_files=[],
                missing_download_links=[],
            )

            found_identifier_indexes: set[int] = set()
            matched_files: list[tuple[str | FileNameFilter, File]] = []

            # Find matching files for each identifier
            for idx, ident in enumerate(identifiers):
                for f in vs_files:
                    if self._matches_file(f, ident):
                        matched_files.append((ident, f))
                        found_identifier_indexes.add(idx)

            # Identify missing files
            for idx, ident in enumerate(identifiers):
                if idx not in found_identifier_indexes:
                    if isinstance(ident, FileNameFilter):
                        ident_str = f"filter:{id(ident)}"
                    else:
                        ident_str = str(ident)
                    missing_report[vs_id].missing_files.append(ident_str)

            # Identify files without download links
            for _ident, f in matched_files:
                if not f.download_link:
                    if isinstance(_ident, FileNameFilter):
                        ident_str = f"filter:{id(_ident)}"
                    else:
                        ident_str = str(_ident)
                    if ident_str not in missing_report[vs_id].missing_download_links:
                        missing_report[vs_id].missing_download_links.append(ident_str)

        return missing_report
