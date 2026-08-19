---
title: Python API Migration – v2 Pagination Naming
nav_order: 12
---

# Python API Migration – Pagination Methods Renamed

This guide covers the API changes introduced in the v2 refactoring of the Python
`dalux-build` client, where **pagination became the default behavior** with
cleaner method names.

## Summary of Changes

The refactoring standardizes pagination across the Python client by:

1. **Renaming primary methods** to remove the `get_all_` prefix
2. **Making pagination automatic** for all renamed methods
3. **Preserving backward compatibility** via deprecated wrapper aliases

### Methods Renamed

| Removed (deprecated)             | Now Use                      | Behavior         |
| -------------------------------- | ---------------------------- | ---------------- |
| `get_all_project_tasks()`        | `get_project_tasks()`        | Auto-paginated ✓ |
| `get_all_project_task_changes()` | `get_project_task_changes()` | Auto-paginated ✓ |
| `get_all_files()`                | `get_files()`                | Auto-paginated ✓ |
| `get_all_files_in_folder()`      | `get_files_in_folder()`      | Auto-paginated ✓ |
| `get_all_folders()`              | `get_folders()`              | Auto-paginated ✓ |
| `get_all_projects()`             | `get_projects()`             | Auto-paginated ✓ |

## Migration Guide

### Before (v1)

```python
# Deprecated: only first page
tasks = dalux.tasks.get_project_tasks(project_id="p1")

# Recommended for all results
tasks = dalux.tasks.get_all_project_tasks(project_id="p1")

# Single page for projects
projects = dalux.projects.list_projects()

# All projects
projects = dalux.projects.get_all_projects()
```

### After (v2)

```python
# All results by default (auto-paginated)
tasks = dalux.tasks.get_project_tasks(project_id="p1")

# All results (consistent naming)
files = dalux.files.get_files(project_id="p1", file_area_id="fa1")
folders = dalux.folders.get_folders(project_id="p1", file_area_id="fa1")
projects = dalux.projects.get_projects()

# Single page (if needed)
projects = dalux.projects.list_projects()  # deprecated but still works
```

## Backward Compatibility

**All old `get_all_*()` method names are preserved and work unchanged**, but
emit a `DeprecationWarning`:

```python
# This still works, but prints:
# DeprecationWarning: get_all_project_tasks() is deprecated. Use get_project_tasks() instead.
tasks = dalux.tasks.get_all_project_tasks(project_id="p1")

# Recommended
tasks = dalux.tasks.get_project_tasks(project_id="p1")
```

## Detailed Changes Per API

### TasksApi

| Old Method                       | New Method                   | Notes                               |
| -------------------------------- | ---------------------------- | ----------------------------------- |
| `get_project_tasks()`            | _(removed as deprecated)_    | Old method only returned first page |
| `get_all_project_tasks()`        | `get_project_tasks()`        | Now primary, auto-paginated         |
| `get_project_task_changes()`     | _(removed as deprecated)_    | Old method only returned first page |
| `get_all_project_task_changes()` | `get_project_task_changes()` | Now primary, auto-paginated         |
| `get_project_task_attachments()` | _(unchanged)_                | Single-page endpoint, no changes    |

**Example:**

```python
# Before
changes = dalux.tasks.get_all_project_task_changes(project_id="p1")

# After
changes = dalux.tasks.get_project_task_changes(project_id="p1")
```

### FilesApi

| Old Method                  | New Method              | Notes                               |
| --------------------------- | ----------------------- | ----------------------------------- |
| `list_files()`              | _(still available)_     | Single-page, deprecated alternative |
| `get_all_files()`           | `get_files()`           | Now primary, auto-paginated         |
| `get_all_files_in_folder()` | `get_files_in_folder()` | Now primary, auto-paginated         |

**Example:**

```python
# Before
all_files = dalux.files.get_all_files(project_id="p1", file_area_id="fa1")

# After
all_files = dalux.files.get_files(project_id="p1", file_area_id="fa1")
```

### FoldersApi

| Old Method          | New Method          | Notes                               |
| ------------------- | ------------------- | ----------------------------------- |
| `list_folders()`    | _(still available)_ | Single-page, deprecated alternative |
| `get_all_folders()` | `get_folders()`     | Now primary, auto-paginated         |

**Example:**

```python
# Before
all_folders = dalux.folders.get_all_folders(project_id="p1", file_area_id="fa1")

# After
all_folders = dalux.folders.get_folders(project_id="p1", file_area_id="fa1")
```

### ProjectsApi

| Old Method           | New Method          | Notes                               |
| -------------------- | ------------------- | ----------------------------------- |
| `list_projects()`    | _(still available)_ | Single-page, deprecated alternative |
| `get_all_projects()` | `get_projects()`    | Now primary, auto-paginated         |

**Example:**

```python
# Before
all_projects = dalux.projects.get_all_projects()

# After
all_projects = dalux.projects.get_projects()
```

## Parameters and Options

All renamed methods keep the same parameter signatures. New methods accept all
options from their predecessors:

```python
# All of these work the same way
df = dalux.files.get_files(
    project_id="p1",
    file_area_id="fa1",
    verbose=True,              # Show pagination progress
    to_dataframe=True,         # Return pandas DataFrame instead of list
    recursively_populate=True, # Enrich user/company references (requires extra API calls)
    include_properties=True,   # For files: include property arrays
)
```

### Common Parameters

- **`verbose`** — Print pagination progress (shows current page, remaining
  items)
- **`to_dataframe`** — Return a flattened pandas DataFrame instead of list
- **`recursively_populate`** — Fetch and enrich user/company references
- **`include_properties`** — (Files only) Include each file's properties array

## Testing & Verification

Run tests with the new method names:

```bash
cd python
pip install -e ".[dev]"
pytest tests/test_api.py -v
pytest tests/test_pydantic_responses.py -v
```

All tests have been updated to use the new method names.

## Deprecation Timeline

- **Now (v2.0):** New methods available, old methods emit `DeprecationWarning`
- **v3.0 (future):** Old methods may be removed; users should migrate by then

## Questions or Issues

If you encounter any issues during migration:

1. Check that you're using the new method names from the table above
2. Ensure you're passing all parameters as keyword arguments (e.g.,
   `project_id=...`)
3. Review the updated
   [Python README](https://github.com/bruadam/dalux-build/blob/main/python/README.md#api-reference)
   for current signatures
4. [Open an issue](https://github.com/bruadam/dalux-build/issues) if you find
   any problems

## See Also

- [Python Client Documentation](python-client.html)
- [Python README – Full API Reference](https://github.com/bruadam/dalux-build/blob/main/python/README.md)
- [Tutorial Repository](https://github.com/bruadam/dalux-build-tuto) (being
  updated)
