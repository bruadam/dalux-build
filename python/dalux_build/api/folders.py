"""Folders API."""

from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Literal, TypedDict, overload

from ..api_client import ApiClient
from ..json_types import JSONDict, JSONValue, QueryParams
from ..models import File, Folder, FolderResponse, FoldersListResponse
from ..response_converter import convert_to_list_response, convert_to_model
from ..utils.pagination import paginate
from ..utils.path_resolver import resolve_folder_id_from_named_path
from ..utils.search import find_by_field
from ..utils.validation import resolve_file_area_id, resolve_project_id

if TYPE_CHECKING:
    from .files import FilesApi

# get_all_folders() falls back to the raw payload (dict) when a page's item
# can't be validated as a Folder, so callers must handle both shapes.
FolderLike = Folder | JSONDict


class TreeNode(TypedDict):
    """A node in the tree built by :meth:`FoldersApi.get_file_area_tree`."""

    id: str | None
    name: str
    path: str
    raw: FolderLike | None
    children: list["TreeNode"]
    files: list[object]


def _folder_payload(item: FolderLike) -> JSONDict:
    """Normalize a Folder object or raw API item into a plain field dict."""
    if isinstance(item, Folder):
        return {
            "folderId": item.folder_id,
            "folderName": item.folder_name,
            "parentFolderId": item.parent_folder_id,
        }
    if "data" in item:
        data = item.get("data")
        return data if isinstance(data, dict) else {}
    return item


def _folder_id(item: FolderLike) -> str | None:
    fid = _folder_payload(item).get("folderId") or _folder_payload(item).get("id")
    return fid if isinstance(fid, str) else None


def _folder_parent_id(item: FolderLike) -> str | None:
    if isinstance(item, Folder):
        return item.parent_folder_id
    data = _folder_payload(item)
    pid = data.get("parentFolderId") or data.get("parentId")
    return pid if isinstance(pid, str) else None


def _folder_name(item: FolderLike) -> str:
    data = _folder_payload(item)
    name = data.get("folderName") or data.get("name") or _folder_id(item) or "?"
    return name if isinstance(name, str) else "?"


class FoldersApi:
    """Methods for folders within a file area."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def list_folders(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[Folder]: ...
    @overload
    def list_folders(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> FoldersListResponse | None: ...
    def list_folders(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> FoldersListResponse | list[Folder] | None:
        """GET /5.1/projects/{projectId}/file_areas/{fileAreaId}/folders.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full FoldersListResponse
                (including metadata and links). If False (default), return
                just the list of Folder items.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            List of Folder items, or the full FoldersListResponse when
            full_response=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        response = self._client.get(
            f"/5.1/projects/{project_id}/file_areas/{file_area_id}/folders",
            params=params,
        )
        result = convert_to_list_response(response, FoldersListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_folders(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[FolderLike]:
        """Retrieve all folders by following bookmark pagination automatically.

        Args:
            params: Optional query parameters.
            verbose: Whether to print progress information.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            List of all folder items, as Folder objects where the payload
            validated cleanly and raw dicts otherwise.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)

        endpoint = f"/5.1/projects/{project_id}/file_areas/{file_area_id}/folders"
        raw_items = paginate(endpoint, self._client, params, verbose)

        # Convert raw items to Folder objects
        folders: list[FolderLike] = []
        for item in raw_items:
            if isinstance(item, dict) and "data" in item:
                folder_data = item["data"]
                try:
                    folder = Folder.model_validate(folder_data)
                    folders.append(folder)
                except Exception:
                    # If conversion fails, fall back to raw data for compatibility
                    if isinstance(folder_data, dict):
                        folders.append(folder_data)
            elif isinstance(item, dict):
                folders.append(item)

        return folders

    def get_folder(
        self,
        folder_id: str,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> FolderResponse | None:
        """GET /5.0/.../folders/{folderId}.

        Returns:
            FolderResponse with folder details.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        response = self._client.get(
            f"/5.0/projects/{project_id}/file_areas/{file_area_id}/folders/{folder_id}"
        )
        return convert_to_model(response, FolderResponse)

    def get_folder_by_path(
        self,
        path: str,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> FolderResponse | None:
        """Get a folder using a full path starting with the file area name."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)

        file_area_id, folder_id = resolve_folder_id_from_named_path(
            self._client, project_id, path, verbose=verbose
        )
        if not file_area_id or not folder_id:
            return None

        return self.get_folder(folder_id, project_id=project_id, file_area_id=file_area_id)

    def get_folder_files_properties(
        self,
        folder_id: str,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> JSONValue | None:
        """GET /1.0/.../folders/{folderId}/files/properties/1.0/mappings."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        return self._client.get(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}"
            f"/folders/{folder_id}/files/properties/1.0/mappings"
        )

    def get_folder_by_name(
        self,
        folder_name: str,
        parent_folder_id: str | None = None,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> FolderResponse | None:
        """Get folder by name, optionally under a parent folder.

        Args:
            folder_name: Name of the folder to search for.
            parent_folder_id: Optional parent folder ID to limit search.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            FolderResponse with folder details if found, None otherwise.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)

        all_folders = self.get_all_folders(project_id=project_id, file_area_id=file_area_id)

        # Use generic search utility
        folder = find_by_field(
            all_folders,
            "folderName",
            folder_name,
            accessor=lambda x: x.get("data") if isinstance(x, dict) and "data" in x else x,
        )

        if not folder or not isinstance(folder, (Folder, dict)):
            return None

        folder_data = _folder_payload(folder)

        if parent_folder_id is not None:
            parent = folder_data.get("parentFolderId") or folder_data.get("parentId")
            if parent != parent_folder_id:
                return None

        # Create a FolderResponse object
        folder_obj = Folder.model_validate(folder_data)
        return FolderResponse(data=folder_obj)

    def get_file_area_tree_by_path(
        self,
        folder_path: str,
        files_api: "FilesApi | None" = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> str | None:
        """Resolve a folder path (e.g., "Folder1/Folder2/Folder3") to a folder ID.

        Supports wildcard matching with * in path segments.

        Args:
            folder_path: Path like "Folder1/Subfolder" or with wildcards "*/SubFolder".
            files_api: Optional FilesApi instance (unused but kept for compatibility).
            verbose: If True, print progress information.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            The folder ID if found, None otherwise.
        """
        import fnmatch

        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)

        folder_path = folder_path.strip("/")
        path_parts = [p.strip() for p in folder_path.split("/") if p.strip()]

        if not path_parts:
            return None

        all_folders = self.get_all_folders(project_id=project_id, file_area_id=file_area_id)

        def _get_fid(folder_data: JSONDict) -> str | None:
            fid = folder_data.get("folderId") or folder_data.get("id")
            return fid if isinstance(fid, str) else None

        def _get_pid(folder_data: JSONDict) -> str:
            pid = folder_data.get("parentFolderId") or folder_data.get("parentId") or ""
            return pid if isinstance(pid, str) else ""

        def _get_name(folder_data: JSONDict) -> str:
            name = folder_data.get("folderName") or folder_data.get("name") or ""
            return name if isinstance(name, str) else ""

        # Find folders that match path segments
        candidate_parent_ids = {file_area_id}

        for segment in path_parts:
            next_candidates: set[str] = set()
            for item in all_folders:
                folder_data = _folder_payload(item)
                fid = _get_fid(folder_data)
                pid = _get_pid(folder_data)
                name = _get_name(folder_data)

                if (
                    fid
                    and pid in candidate_parent_ids
                    and fnmatch.fnmatch(name.lower(), segment.lower())
                ):
                    next_candidates.add(fid)

            if not next_candidates:
                if verbose:
                    print(f"Folder segment '{segment}' not found")
                return None

            candidate_parent_ids = next_candidates

        if len(candidate_parent_ids) == 1:
            return candidate_parent_ids.pop()
        elif len(candidate_parent_ids) > 1:
            if verbose:
                print(f"Multiple folders match path '{folder_path}'")
            return next(iter(candidate_parent_ids))

        return None

    def get_file_area_tree(
        self,
        files_api: "FilesApi | None" = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> TreeNode:
        """Build the complete folder+file tree for a file area efficiently.

        Fetches all folders (and optionally all files) and assembles them into a
        nested tree. When *files_api* is provided, folders and files are fetched
        **concurrently** in two threads.

        Each node has the shape::

            {
                "id": "<folderId | None for root>",
                "name": "<folder name>",
                "path": "parent/child/name",
                "raw":  <original API item>,
                "children": [<child folder nodes>, ...],
                "files": [<file items belonging to this folder>, ...],
            }

        The returned root node represents the file-area root (``id=None``).

        Args:
            files_api: Optional :class:`FilesApi` instance. When provided, files
                are fetched in parallel and attached to their folder nodes.
            verbose: If ``True``, print progress information.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            Root tree node (dict).
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)

        def _fetch_files() -> list[object]:
            assert files_api is not None
            return list(
                files_api.get_all_files(
                    verbose=verbose, project_id=project_id, file_area_id=file_area_id
                )
            )

        all_files: list[object]
        if files_api is not None:
            with ThreadPoolExecutor(max_workers=2) as executor:
                folders_fut = executor.submit(
                    self.get_all_folders, project_id=project_id, file_area_id=file_area_id
                )
                files_fut = executor.submit(_fetch_files)
                all_folders = folders_fut.result()
                all_files = files_fut.result()
        else:
            all_folders = self.get_all_folders(project_id=project_id, file_area_id=file_area_id)
            all_files = []

        if verbose:
            print(f"Building tree: {len(all_folders)} folder(s), {len(all_files)} file(s)")

        # --- build node map ---
        nodes: dict[str, TreeNode] = {}
        for folder in all_folders:
            fid = _folder_id(folder)
            if fid is None:
                continue
            nodes[fid] = {
                "id": fid,
                "name": _folder_name(folder),
                "path": "",
                "raw": folder,
                "children": [],
                "files": [],
            }

        # --- wire parent → child relationships ---
        root: TreeNode = {
            "id": None,
            "name": file_area_id,
            "path": "",
            "raw": None,
            "children": [],
            "files": [],
        }
        for folder in all_folders:
            fid = _folder_id(folder)
            if fid is None:
                continue
            pid = _folder_parent_id(folder)
            parent = nodes.get(pid, root) if pid is not None else root
            parent["children"].append(nodes[fid])

        # --- compute slash-separated paths ---
        def _set_paths(node: TreeNode, parent_path: str) -> None:
            node["path"] = f"{parent_path}/{node['name']}" if parent_path else node["name"]
            for child in node["children"]:
                _set_paths(child, node["path"])

        for child in root["children"]:
            _set_paths(child, "")

        # --- attach files to their folder nodes ---
        for f in all_files:
            # Handle both File objects and dict format
            file_folder_id: str | None = None
            if isinstance(f, File):
                file_folder_id = f.folder_id
            elif isinstance(f, dict) and "data" in f:
                data = f.get("data")
                if isinstance(data, dict):
                    candidate = data.get("folderId")
                    file_folder_id = candidate if isinstance(candidate, str) else None

            target = nodes.get(file_folder_id, root) if file_folder_id else root
            target["files"].append(f)

        return root
