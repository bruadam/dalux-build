"""Single-instance persistent monitor scheduler."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from .cron import next_run
from .delivery import DeliveryWorker
from .monitor import Monitor
from .store import Store

logger = logging.getLogger(__name__)


class Scheduler:
    def __init__(self, store: Store, monitor: Monitor, deliveries: DeliveryWorker) -> None:
        self.store = store
        self.monitor = monitor
        self.deliveries = deliveries
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="dalux-monitor")
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)
        self._thread = None

    def _loop(self) -> None:
        while not self._stop.is_set():
            now = datetime.now(timezone.utc)
            for row in self.store.due_jobs(now):
                following = next_run(row["cron"], row["timezone"], now)
                if not self.store.claim(row["job_id"], following):
                    continue
                run_id = self.store.start_run(row["job_id"], now)
                try:
                    self.monitor.run(row, now)
                    self.store.finish_run(run_id, "succeeded")
                except Exception as exc:
                    self.store.finish_run(run_id, "failed", str(exc))
                    logger.exception("Monitor job %s failed", row["job_id"])
                finally:
                    completed = datetime.now(timezone.utc)
                    self.store.release(
                        row["job_id"], next_run(row["cron"], row["timezone"], completed)
                    )
            try:
                self.deliveries.drain()
            except Exception:
                logger.exception("Delivery worker failed")
            self._stop.wait(1.0)
