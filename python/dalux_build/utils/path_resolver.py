"""Shared path resolution helpers for Dalux file areas and folders."""

from typing import TYPE_CHECKING

from ..models import FileArea
from .search import find_by_field

if TYPE_CHECKING:
    from ..api.folders import FolderLike
    from ..api_client import ApiClient


def resolve_file_area_by_name(
    api_client: "ApiClient",
    project_id: str,
    file_area_name: str,
    file_areas_cache: dict[str, FileArea] | None = None,
) -> FileArea | None:
    """Resolve a file area by its displayed name."""
    from ..api.file_areas import FileAreasApi

    if file_areas_cache is not None and file_area_name in file_areas_cache:
        return file_areas_cache[file_area_name]

    if api_client._verbose_path_resolution:
        print(f"GET /5.1/projects/{project_id}/file_areas")
    items = FileAreasApi(api_client).get_file_areas(project_id=project_id)
    if not items:
        return None

    if file_areas_cache is not None:
        for item in items:
            file_areas_cache[item.file_area_name] = item

    return find_by_field(items, "file_area_name", file_area_name)


def resolve_folder_id_from_named_path(
    api_client: "ApiClient",
    project_id: str,
    path: str,
    verbose: bool = False,
    file_areas_cache: dict[str, FileArea] | None = None,
    folders_cache: dict[str, list["FolderLike"]] | None = None,
    resolved_paths_cache: dict[str, tuple[str | None, str | None]] | None = None,
) -> tuple[str | None, str | None]:
    """Resolve ``file_area_name/folder/...`` to ``(file_area_id, folder_id)``."""
    from ..api.folders import FoldersApi, _folder_id, _folder_name, _folder_parent_id

    if resolved_paths_cache is not None and path in resolved_paths_cache:
        return resolved_paths_cache[path]

    path_parts = [part.strip() for part in path.strip("/").split("/") if part.strip()]
    if len(path_parts) < 2:
        return None, None

    file_area_name = path_parts[0]
    folder_names = path_parts[1:]
    api_client._verbose_path_resolution = verbose
    file_area = resolve_file_area_by_name(
        api_client,
        project_id,
        file_area_name,
        file_areas_cache=file_areas_cache,
    )
    if not file_area:
        api_client._verbose_path_resolution = False
        if verbose:
            print(f"Could not resolve file area: {file_area_name}")
        return None, None

    file_area_id = file_area.file_area_id
    folders = folders_cache.get(file_area_id) if folders_cache is not None else None
    if folders is None:
        if verbose:
            print(f"GET /5.1/projects/{project_id}/file_areas/{file_area_id}/folders")
        folders = FoldersApi(api_client).get_all_folders(
            verbose=verbose, project_id=project_id, file_area_id=file_area_id
        )
        if folders_cache is not None:
            folders_cache[file_area_id] = folders
    api_client._verbose_path_resolution = False

    all_folder_ids = {_folder_id(folder) for folder in folders}
    folder_index: dict[tuple[str | None, str], str] = {}
    for folder in folders:
        fid = _folder_id(folder)
        if fid is None:
            continue
        candidate_parent_id = _folder_parent_id(folder)
        key_parent = candidate_parent_id if candidate_parent_id in all_folder_ids else None
        folder_index[(key_parent, _folder_name(folder))] = fid

    parent_folder_id: str | None = None
    for folder_name in folder_names:
        matched_folder_id = folder_index.get((parent_folder_id, folder_name))
        if not matched_folder_id:
            if verbose:
                print(f"Could not resolve folder segment: {folder_name}")
            not_found: tuple[str | None, str | None] = (file_area_id, None)
            if resolved_paths_cache is not None:
                resolved_paths_cache[path] = not_found
            return not_found
        parent_folder_id = matched_folder_id

    result: tuple[str | None, str | None] = (file_area_id, parent_folder_id)
    if resolved_paths_cache is not None:
        resolved_paths_cache[path] = result
    return result
