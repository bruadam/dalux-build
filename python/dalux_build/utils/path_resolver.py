"""Shared path resolution helpers for Dalux file areas and folders."""

from typing import Any, Dict, Optional

from ..models import FileArea, Folder
from .search import find_by_field


def resolve_file_area_by_name(
    api_client,
    project_id: str,
    file_area_name: str,
    file_areas_cache: Optional[Dict[str, FileArea]] = None,
) -> Optional[FileArea]:
    """Resolve a file area by its displayed name."""
    from ..api.file_areas import FileAreasApi

    if file_areas_cache is not None and file_area_name in file_areas_cache:
        return file_areas_cache[file_area_name]

    if getattr(api_client, "_verbose_path_resolution", False):
        print(f"GET /5.1/projects/{project_id}/file_areas")
    response = FileAreasApi(api_client).get_file_areas(project_id)
    if not response or not response.items:
        return None

    if file_areas_cache is not None:
        for item in response.items:
            file_areas_cache[item.file_area_name] = item

    return find_by_field(response.items, "file_area_name", file_area_name)


def resolve_folder_id_from_named_path(
    api_client,
    project_id: str,
    path: str,
    verbose: bool = False,
    file_areas_cache: Optional[Dict[str, FileArea]] = None,
    folders_cache: Optional[Dict[str, list]] = None,
    resolved_paths_cache: Optional[Dict[str, tuple[Optional[str], Optional[str]]]] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Resolve ``file_area_name/folder/...`` to ``(file_area_id, folder_id)``."""
    from ..api.folders import FoldersApi

    if resolved_paths_cache is not None and path in resolved_paths_cache:
        return resolved_paths_cache[path]

    path_parts = [part.strip() for part in path.strip("/").split("/") if part.strip()]
    if len(path_parts) < 2:
        return None, None

    file_area_name = path_parts[0]
    folder_names = path_parts[1:]
    setattr(api_client, "_verbose_path_resolution", verbose)
    file_area = resolve_file_area_by_name(
        api_client,
        project_id,
        file_area_name,
        file_areas_cache=file_areas_cache,
    )
    if not file_area:
        setattr(api_client, "_verbose_path_resolution", False)
        if verbose:
            print(f"Could not resolve file area: {file_area_name}")
        return None, None

    file_area_id = file_area.file_area_id
    folders = folders_cache.get(file_area_id) if folders_cache is not None else None
    if folders is None:
        if verbose:
            print(f"GET /5.1/projects/{project_id}/file_areas/{file_area_id}/folders")
        folders = FoldersApi(api_client).get_all_folders(project_id, file_area_id, verbose=verbose)
        if folders_cache is not None:
            folders_cache[file_area_id] = folders
    setattr(api_client, "_verbose_path_resolution", False)
    all_folder_ids = {
        folder.folder_id
        for folder in folders
        if isinstance(folder, Folder)
    }
    folder_index = {}
    for folder in folders:
        if not isinstance(folder, Folder):
            continue
        parent_folder_id = folder.parent_folder_id
        key_parent = parent_folder_id if parent_folder_id in all_folder_ids else None
        folder_index[(key_parent, folder.folder_name)] = folder

    parent_folder_id: Optional[str] = None
    for folder_name in folder_names:
        folder = folder_index.get((parent_folder_id, folder_name))
        if not folder:
            if verbose:
                print(f"Could not resolve folder segment: {folder_name}")
            result = (file_area_id, None)
            if resolved_paths_cache is not None:
                resolved_paths_cache[path] = result
            return result
        parent_folder_id = folder.folder_id

    result = (file_area_id, parent_folder_id)
    if resolved_paths_cache is not None:
        resolved_paths_cache[path] = result
    return result
