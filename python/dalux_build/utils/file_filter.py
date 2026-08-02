"""Shared file-name filtering logic used by FilesApi and VersionSetsApi."""

import fnmatch
import re
from collections.abc import Callable
from typing import TYPE_CHECKING, TypeVar

if TYPE_CHECKING:
    from ..models import FileNameFilter

T = TypeVar("T")


def _normalize_extensions(extensions: list[str] | None) -> list[str]:
    return [(ext if ext.startswith(".") else f".{ext}").lower() for ext in extensions or [] if ext]


def matches_file_name_filter(file_name: str, file_filter: "FileNameFilter") -> bool:
    """Check whether *file_name* satisfies every rule set on *file_filter*.

    Text rules (contains/startswith/endswith/extensions) are matched
    case-insensitively. ``pattern``/``patterns`` (regex) and
    ``wildcard``/``wildcards`` (glob) are matched against the original-case
    name.
    """
    name_lower = file_name.lower()

    if file_filter.contains:
        values = [v.lower() for v in file_filter.contains]
        matched = (
            all(v in name_lower for v in values)
            if file_filter.contains_match == "all"
            else any(v in name_lower for v in values)
        )
        if not matched:
            return False

    if file_filter.not_contains and any(v.lower() in name_lower for v in file_filter.not_contains):
        return False

    if file_filter.startswith and not any(
        name_lower.startswith(v.lower()) for v in file_filter.startswith
    ):
        return False

    if file_filter.not_startswith and any(
        name_lower.startswith(v.lower()) for v in file_filter.not_startswith
    ):
        return False

    if file_filter.endswith and not any(
        name_lower.endswith(v.lower()) for v in file_filter.endswith
    ):
        return False

    if file_filter.not_endswith and any(
        name_lower.endswith(v.lower()) for v in file_filter.not_endswith
    ):
        return False

    if file_filter.extensions and not any(
        name_lower.endswith(ext) for ext in _normalize_extensions(file_filter.extensions)
    ):
        return False

    if file_filter.not_extensions and any(
        name_lower.endswith(ext) for ext in _normalize_extensions(file_filter.not_extensions)
    ):
        return False

    if file_filter.pattern:
        try:
            if not re.search(file_filter.pattern, file_name, re.IGNORECASE):
                return False
        except re.error:
            return False

    if file_filter.patterns:
        try:
            if not any(re.search(p, file_name, re.IGNORECASE) for p in file_filter.patterns):
                return False
        except re.error:
            return False

    if file_filter.wildcard and not fnmatch.fnmatchcase(file_name, file_filter.wildcard):
        return False

    if file_filter.wildcards and not any(
        fnmatch.fnmatchcase(file_name, wc) for wc in file_filter.wildcards
    ):
        return False

    return True


def filter_files_by_name(
    items: list[T],
    file_filter: "FileNameFilter",
    *,
    name_getter: Callable[[T], str],
    verbose: bool = False,
) -> list[T]:
    """Filter *items* to those whose extracted name matches *file_filter*."""
    filtered = [item for item in items if matches_file_name_filter(name_getter(item), file_filter)]
    if verbose:
        print(f"Files matching filter: {len(filtered)} / {len(items)}")
    return filtered
