"""Utilities for the Dalux Build API client."""

from .exceptions import ApiError, DaluxError, NotFoundError, ValidationError
from .pagination import get_next_page_params, has_next_page, paginate
from .path_resolver import resolve_file_area_by_name, resolve_folder_id_from_named_path
from .search import find_all_by_field, find_by_field
from .validation import (
    resolve_file_area_id,
    resolve_project_id,
    validate_file_area_id,
    validate_project_id,
)

__all__ = [
    "paginate",
    "has_next_page",
    "get_next_page_params",
    "resolve_file_area_by_name",
    "resolve_folder_id_from_named_path",
    "find_by_field",
    "find_all_by_field",
    "DaluxError",
    "NotFoundError",
    "ApiError",
    "ValidationError",
    "validate_project_id",
    "validate_file_area_id",
    "resolve_project_id",
    "resolve_file_area_id",
]
