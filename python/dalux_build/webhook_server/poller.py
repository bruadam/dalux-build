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
from typing import Protocol

from ..api.files import FileLike
from ..json_types import QueryParams
from ..models import File
from . import qa
from .config import QaConfig
from .service import DaluxFileService
from .store import Store
from .watchlist import WatchedFile, WatchList

logger = logging.getLogger("dalux_build.webhook_server.poller")


class PollerContext(Protocol):
    """Duck-typed context :func:`poll_once` needs.

    Both the embedded ``WebhookServerApi`` and the standalone CLI's
    ``AppContext`` satisfy this without inheriting from it.
    """

    watchlist: WatchList
    store: Store
    dalux: DaluxFileService
    qa_config: QaConfig


def _by_area(files: list[WatchedFile]) -> dict[tuple[str, str], list[WatchedFile]]:
    grouped: dict[tuple[str, str], list[WatchedFile]] = {}
    for f in files:
        grouped.setdefault((f.project_id, f.file_area_id), []).append(f)
    return grouped


def _candidate_file_id(item: FileLike) -> str | None:
    if isinstance(item, File):
        return item.file_id
    data = item.get("data")
    fid = data.get("fileId") if isinstance(data, dict) else item.get("fileId")
    return fid if isinstance(fid, str) else None


def poll_once(ctx: PollerContext, updated_after: str | None = None, mode: str = "per-file") -> int:
    """Check every watched file once; return the number of changed files."""
    changed = 0
    for (project_id, file_area_id), watched in _by_area(ctx.watchlist.all()).items():
        watched_ids = {w.file_id for w in watched}

        candidate_ids: set[str]
        if mode == "list":
            params: QueryParams | None = {"updatedAfter": updated_after} if updated_after else None
            candidates = ctx.dalux.list_all_files(project_id, file_area_id, params=params)
            found_ids = {_candidate_file_id(c) for c in candidates}
            candidate_ids = {fid for fid in found_ids if fid is not None} & watched_ids
        else:
            candidate_ids = watched_ids

        for file_id in candidate_ids:
            result = ctx.dalux.check(project_id, file_area_id, file_id, download=True)
            if result.changed:
                changed += 1
                qa.trigger(ctx.qa_config, qa.build_event(result, project_id, file_area_id))
                logger.info("Changed: %s -> %s", file_id, result.downloaded_path)
    return changed
