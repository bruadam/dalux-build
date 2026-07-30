"""Polling fallback for when Dalux webhooks are unavailable or to heal gaps.

The actual per-tick logic lives in ``dalux_build.webhook_server.poller.poll_once``
(shared with the embedded ``DaluxClient.webhook_server``); this module keeps
only the CLI concerns: argument parsing and the interval/scheduling loop.

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

from dalux_build.webhook_server.poller import poll_once  # noqa: F401

from .app import AppContext
from .config import get_settings

logger = logging.getLogger("dalux_webhook.poller")


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
