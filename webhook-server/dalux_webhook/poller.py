"""Polling fallback for when Dalux webhooks are unavailable or to heal gaps.

Two modes per watched file area:

* ``per-file`` (default): call ``get_file`` metadata for each watched file id
  and download the ones that changed; simple and predictable.
* ``list``: call ``list_files`` with ``updatedAfter`` (and ``folderId`` when
  given) to shrink the candidate set, intersect with the watch list, then
  confirm + download. The files endpoint has no OData ``$filter``, so the
  intersection is done client-side.

Run once with ``python -m dalux_webhook.poller`` (ideal for an OS cron job or a
systemd timer, which provide drift-free wall-clock scheduling), or run as a
long-lived process with ``--interval 300``. The built-in interval uses a
fixed-rate monotonic schedule, so the poll's own run time is not added to the
gap between wake-ups.
"""
from __future__ import annotations

import argparse
import logging
import time
from typing import Dict, List, Optional

from . import qa
from .app import AppContext
from .config import get_settings
from .watchlist import WatchedFile

logger = logging.getLogger("dalux_webhook.poller")


def _by_area(files: List[WatchedFile]) -> Dict[tuple, List[WatchedFile]]:
    grouped: Dict[tuple, List[WatchedFile]] = {}
    for f in files:
        grouped.setdefault((f.project_id, f.file_area_id), []).append(f)
    return grouped


def poll_once(ctx: AppContext, updated_after: Optional[str] = None, mode: str = "per-file") -> int:
    """Check every watched file once; return the number of changed files."""
    changed = 0
    for (project_id, file_area_id), watched in _by_area(ctx.watchlist.all()).items():
        watched_ids = {w.file_id for w in watched}

        if mode == "list":
            params = {"updatedAfter": updated_after} if updated_after else None
            candidates = ctx.dalux.list_all_files(project_id, file_area_id, params=params)
            candidate_ids = {
                (c.get("data") or {}).get("fileId") for c in candidates
            } & watched_ids
        else:
            candidate_ids = watched_ids

        for file_id in candidate_ids:
            result = ctx.dalux.check(project_id, file_area_id, file_id, download=True)
            if result.changed:
                changed += 1
                qa.trigger(ctx.settings, qa.build_event(result, project_id, file_area_id))
                logger.info("Changed: %s -> %s", file_id, result.downloaded_path)
    return changed


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Poll Dalux for watched file changes")
    parser.add_argument("--interval", type=int, default=0, help="Seconds between polls (0 = run once)")
    parser.add_argument("--updated-after", default=None, help="Only used in --mode list")
    parser.add_argument("--mode", choices=["per-file", "list"], default="per-file")
    args = parser.parse_args()

    ctx = AppContext(get_settings())

    if args.interval <= 0:
        count = poll_once(ctx, updated_after=args.updated_after, mode=args.mode)
        logger.info("Poll complete: %d changed file(s)", count)
        return

    # Fixed-rate schedule: wake-ups are anchored to a monotonic clock so the
    # poll's own run time is not added to the interval. If a cycle overruns the
    # interval, missed ticks are skipped to avoid a catch-up burst.
    next_run = time.monotonic()
    while True:
        count = poll_once(ctx, updated_after=args.updated_after, mode=args.mode)
        logger.info("Poll complete: %d changed file(s)", count)

        next_run += args.interval
        now = time.monotonic()
        if next_run <= now:
            skipped = int((now - next_run) // args.interval) + 1
            next_run += skipped * args.interval
            logger.warning(
                "Poll overran its interval; skipping %d missed tick(s)", skipped
            )
        time.sleep(max(0.0, next_run - time.monotonic()))


if __name__ == "__main__":
    main()
