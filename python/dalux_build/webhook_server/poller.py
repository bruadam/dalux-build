"""Polling fallback for when Dalux webhooks are unavailable or to heal gaps.

Two modes per watched file area:

* ``per-file`` (default): call ``get_file`` metadata for each watched file id
  and download the ones that changed; simple and predictable.
* ``list``: call ``list_all_files`` with ``updatedAfter`` (and ``folderId``
  when given) to shrink the candidate set, intersect with the watch list,
  then confirm + download. The files endpoint has no OData ``$filter``, so the
  intersection is done client-side.

``poll_once`` is duck-typed over any object exposing ``.watchlist``, ``.store``,
and ``.dalux`` (a :class:`~dalux_build.webhook_server.service.DaluxFileService`),
so both the embedded ``WebhookServerApi`` and the standalone CLI's
``AppContext`` can reuse it unchanged.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List

from . import qa
from .watchlist import WatchedFile

logger = logging.getLogger("dalux_build.webhook_server.poller")


def _by_area(files: List[WatchedFile]) -> Dict[tuple, List[WatchedFile]]:
    grouped: Dict[tuple, List[WatchedFile]] = {}
    for f in files:
        grouped.setdefault((f.project_id, f.file_area_id), []).append(f)
    return grouped


def poll_once(ctx: Any, updated_after: str = None, mode: str = "per-file") -> int:
    """Check every watched file once; return the number of changed files."""
    changed = 0
    for (project_id, file_area_id), watched in _by_area(ctx.watchlist.all()).items():
        watched_ids = {w.file_id for w in watched}

        if mode == "list":
            params = {"updatedAfter": updated_after} if updated_after else None
            candidates = ctx.dalux.list_all_files(project_id, file_area_id, params=params)
            candidate_ids = {
                getattr(c, "file_id", None) for c in candidates
            } & watched_ids
        else:
            candidate_ids = watched_ids

        for file_id in candidate_ids:
            result = ctx.dalux.check(project_id, file_area_id, file_id, download=True)
            if result.changed:
                changed += 1
                qa.trigger(ctx.qa_config, qa.build_event(result, project_id, file_area_id))
                logger.info("Changed: %s -> %s", file_id, result.downloaded_path)
    return changed
