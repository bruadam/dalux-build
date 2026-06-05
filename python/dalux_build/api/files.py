"""Files API."""
import os
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from .folders import FoldersApi

import requests

from ..api_client import ApiClient


class FilesApi:
    """Methods for files within a file area."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_files(
        self,
        project_id: str,
        file_area_id: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files.

        See ``docs/official-api-docs/Dalux Build API.yaml`` (operationId: listFiles).
        Pass ``includeProperties=True`` in *params* to return each file's
        properties array. The files endpoint does not support OData ``$filter``.
        """
        return self._client.get(
            f"/6.1/projects/{project_id}/file_areas/{file_area_id}/files",
            params=params,
        )

    def get_all_files(
        self,
        project_id: str,
        file_area_id: str,
        params: Optional[Dict[str, Any]] = None,
        verbose: bool = False,
    ) -> list:
        """Retrieve all files by following bookmark pagination automatically.

        Combines all pages into a single list of items.

        Args:
            project_id: Project ID.
            file_area_id: File area ID.
            params: Optional additional query parameters.
            verbose: If True, print progress using totalRemainingItems from metadata.
        """
        from urllib.parse import parse_qs, urlparse

        all_items = []
        current_params = dict(params or {})
        has_next_page = True

        while has_next_page:
            response = self._client.get(
                f"/6.1/projects/{project_id}/file_areas/{file_area_id}/files",
                params=current_params,
            )
            items = response.get("items") if response else None
            if items:
                all_items.extend(items)
            remaining = (response.get("metadata") or {}).get("totalRemainingItems", 0)
            if verbose:
                print(f"Retrieved {len(all_items)} files so far, {remaining} remaining...")
            # Stop if no items were returned or nothing left
            if not items or remaining == 0:
                has_next_page = False
            else:
                next_link = next(
                    (l for l in (response.get("links") or []) if l.get("rel") == "nextPage"),
                    None,
                )
                if next_link:
                    qs = parse_qs(urlparse(next_link["href"]).query)
                    bookmark = qs.get("bookmark", [None])[0]
                    current_params = {**dict(params or {}), "bookmark": bookmark}
                else:
                    has_next_page = False

        if verbose:
            print(f"Done. Total files retrieved: {len(all_items)}")
        return all_items

    def get_all_files_in_folder(
        self,
        project_id: str,
        file_area_id: str,
        folder_id: str,
        params: Optional[Dict[str, Any]] = None,
        verbose: bool = False,
    ) -> list:
        """Retrieve all files for a specific folder by filtering get_all_files results.

        Args:
            project_id: Project ID.
            file_area_id: File area ID.
            folder_id: The folder ID to filter files by.
            params: Optional additional query parameters passed to the API.
            verbose: If True, print progress information.

        Returns:
            A list of file items belonging to the specified folder.
        """
        all_files = self.get_all_files(project_id, file_area_id, params=params, verbose=verbose)
        filtered = [
            f for f in all_files
            if (f.get("data") or {}).get("folderId") == folder_id
        ]
        if verbose:
            print(f"Files matching folder {folder_id!r}: {len(filtered)}")
        return filtered

    def bulk_download_folder(
        self,
        project_id: str,
        file_area_id: str,
        folder_id: str,
        save_path: Optional[str] = None,
        filename_keywords: Optional[list] = None,
        filename_keywords_match: str = "any",
        filename_extensions: Optional[list] = None,
        params: Optional[Dict[str, Any]] = None,
        verbose: bool = False,
    ) -> list:
        """Download all files in a folder, optionally filtered by fileName keywords and/or extensions.

        Args:
            project_id: Project ID.
            file_area_id: File area ID.
            folder_id: The folder ID to download files from.
            save_path: Optional directory to save downloaded files. Defaults to current directory.
            filename_keywords: Optional list of keyword strings to match against the fileName
                (case-insensitive). E.g. ["ARC", "STR"].
            filename_keywords_match: "any" (default) to match files containing at least one keyword,
                "all" to require all keywords to be present in the fileName.
            filename_extensions: Optional list of file extensions to match against the fileName
                (e.g. [".ifc", ".rvt"]). Case-insensitive. Leading dot is optional.
            params: Optional additional query parameters passed to the API.
            verbose: If True, print progress information.

        Returns:
            A list of dicts with 'fileName' and 'downloaded_file_path' for each downloaded file.
        """
        files = self.get_all_files_in_folder(
            project_id, file_area_id, folder_id, params=params, verbose=verbose
        )

        filtered = files
        if filename_keywords:
            if filename_keywords_match == "all":
                match_fn = lambda name: all(kw.lower() in name for kw in filename_keywords)
            else:
                match_fn = lambda name: any(kw.lower() in name for kw in filename_keywords)
            filtered = [
                f for f in filtered
                if match_fn((f.get("data") or {}).get("fileName", "").lower())
            ]
            if verbose:
                print(f"Files matching fileName keywords {filename_keywords} ({filename_keywords_match}): {len(filtered)} / {len(files)}")

        if filename_extensions:
            norm_exts = [
                (ext if ext.startswith(".") else f".{ext}").lower()
                for ext in filename_extensions
            ]
            before = len(filtered)
            filtered = [
                f for f in filtered
                if any(
                    (f.get("data") or {}).get("fileName", "").lower().endswith(ext)
                    for ext in norm_exts
                )
            ]
            if verbose:
                print(f"Files matching fileName extensions {norm_exts}: {len(filtered)} / {before}")

        results = []
        for i, f in enumerate(filtered, 1):
            data = f.get("data") or {}
            file_name = data.get("fileName", data.get("fileId", f"file_{i}"))
            download_link = data.get("downloadLink")
            if not download_link:
                if verbose:
                    print(f"  [{i}/{len(filtered)}] Skipping {file_name!r} (no downloadLink)")
                continue
            if verbose:
                print(f"  [{i}/{len(filtered)}] Downloading {file_name!r}...")
            downloaded_path = self.download_file_from_link(download_link, file_name, save_path)
            results.append({"fileName": file_name, "downloaded_file_path": downloaded_path})

        if verbose:
            print(f"Bulk download complete. {len(results)} file(s) downloaded.")
        return results

    def bulk_download_by_ids(
        self,
        project_id: str,
        file_area_id: str,
        file_ids: List[str],
        save_path: Optional[str] = None,
        verbose: bool = False,
    ) -> List[Dict[str, Any]]:
        """Download a list of files by their file IDs.

        Fetches metadata for each ID and downloads the file using its download link.

        Args:
            project_id: Project ID.
            file_area_id: File area ID.
            file_ids: List of file IDs to download.
            save_path: Optional directory to save files. Defaults to current directory.
            verbose: If True, print progress per file.

        Returns:
            List of dicts with ``fileId``, ``fileName``, and ``downloaded_file_path``
            for each successfully downloaded file.
        """
        results: List[Dict[str, Any]] = []
        total = len(file_ids)
        for i, file_id in enumerate(file_ids, 1):
            file_info = self.get_file(project_id, file_area_id, file_id)
            data = (file_info or {}).get("data") or {}
            file_name = data.get("fileName", file_id)
            download_link = data.get("downloadLink")
            if not download_link:
                if verbose:
                    print(f"  [{i}/{total}] Skipping {file_name!r} (no downloadLink)")
                continue
            if verbose:
                print(f"  [{i}/{total}] Downloading {file_name!r}...")
            downloaded_path = self.download_file_from_link(download_link, file_name, save_path)
            results.append({
                "fileId": file_id,
                "fileName": file_name,
                "downloaded_file_path": downloaded_path,
            })
        if verbose:
            print(f"Done. {len(results)}/{total} file(s) downloaded.")
        return results

    def get_file(
        self,
        project_id: str,
        file_area_id: str,
        file_id: str,
        download: bool = False,
        save_path: Optional[str] = None,
    ) -> Any:
        """GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}.

        If download=True, will also download the file using the download link in the response.

        Args:
            project_id: Project ID.
            file_area_id: File area ID.
            file_id: File ID.
            download: If True, download the file content using the download link.
            save_path: Optional directory to save the file (default: current directory).

        Returns:
            The file info dict. If download=True, the path to the downloaded file is
            added as 'downloaded_file_path' in the returned dict.
        """
        file_info = self._client.get(
            f"/5.0/projects/{project_id}/file_areas/{file_area_id}/files/{file_id}"
        )
        if download and file_info and "data" in file_info and "downloadLink" in file_info["data"]:
            file_name = file_info["data"].get("fileName", file_id)
            download_link = file_info["data"]["downloadLink"]
            downloaded_path = self.download_file_from_link(download_link, file_name, save_path)
            file_info["downloaded_file_path"] = downloaded_path
        return file_info

    def download_file_from_link(
        self,
        download_link: str,
        file_name: str,
        save_path: Optional[str] = None,
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

        api_key = self._client._configuration.api_key
        headers = {"X-API-KEY": api_key}

        response = requests.get(download_link, headers=headers, stream=True)
        if response.status_code == 200:
            with open(file_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return file_path
        else:
            raise Exception(f"Failed to download file. Status code: {response.status_code}")

    def select_files_interactive(
        self,
        project_id: str,
        file_area_id: str,
        tree: Optional[Dict[str, Any]] = None,
        folders_api: Optional["FoldersApi"] = None,
    ) -> List[str]:
        """Interactively browse the folder tree level-by-level and select files.

        Navigation works like a simple file browser:
        - Type a **folder number** (single token) to enter that folder.
        - Type ``b`` (or ``back``) to go up one level.
        - Type **file numbers / ranges** to toggle selection (``✓`` marks selected files).
        - Type ``d`` (or ``done``) to finish and return the selected file IDs.
        - Empty folders are hidden; folders and files are sorted alphabetically.

        Args:
            project_id: Project ID.
            file_area_id: File area ID.
            tree: Pre-built tree from :meth:`FoldersApi.get_file_area_tree`.
                If not provided, *folders_api* must be supplied so the tree
                can be built automatically (files are fetched in parallel).
            folders_api: :class:`FoldersApi` instance used to build the tree
                when *tree* is ``None``.

        Returns:
            Ordered list of selected file IDs (in order they were selected).

        Raises:
            ValueError: If neither *tree* nor *folders_api* is provided.
        """
        if tree is None:
            if folders_api is None:
                raise ValueError("Either 'tree' or 'folders_api' must be provided.")
            tree = folders_api.get_file_area_tree(project_id, file_area_id, files_api=self)

        # ------------------------------------------------------------------ helpers
        def _fid(f: Any) -> Optional[str]:
            d = f.get("data") or {}
            return d.get("id") or d.get("fileId")

        def _fname(f: Any) -> str:
            return (f.get("data") or {}).get("fileName", "<unknown>")

        def _has_content(node: Dict[str, Any]) -> bool:
            if node["files"]:
                return True
            return any(_has_content(c) for c in node["children"])

        def _count_files(node: Dict[str, Any]) -> int:
            return len(node["files"]) + sum(_count_files(c) for c in node["children"])

        def _parse_tokens(raw: str, max_idx: int) -> set:
            chosen: set = set()
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
        selected_ids: List[str] = []
        selected_set: set = set()
        stack: List[Dict[str, Any]] = [tree]

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
        self, project_id: str, file_area_id: str, file_id: str
    ) -> Any:
        """GET .../files/{fileId}/properties/1.0/mappings."""
        return self._client.get(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}"
            f"/files/{file_id}/properties/1.0/mappings"
        )

    def get_file_property_mapping_values(
        self, project_id: str, file_area_id: str, file_property_id: str
    ) -> Any:
        """GET .../files/properties/1.0/mappings/{filePropertyId}/values."""
        return self._client.get(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}"
            f"/files/properties/1.0/mappings/{file_property_id}/values"
        )
