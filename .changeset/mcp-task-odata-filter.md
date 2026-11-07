---
"dalux-build-mcp": patch
---

Task tools no longer forward OData that Dalux rejects. `list_project_tasks`, `search_tasks` and `build_task_index` send only the `data/type/typeId eq '<id>'` clause as `$filter`; other simple clauses (`and`, comparisons, `contains`, `startswith`) become client-side `conditions` and are reported in `filterNote`; `or`/`not`/other functions fail with a clear error before any Dalux call. `select` and `orderby` are applied client-side, because Dalux rejected every value tried. Dalux task-listing errors now include the OData that was sent.
