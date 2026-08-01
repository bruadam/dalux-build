"""The set of files the webhook server reacts to.

A watch list maps each watched file to the ``project_id`` / ``file_area_id``
needed to call the Dalux Build API. Webhook events for files that are not on
the list are ignored, and the poller only checks files on the list.

The list is mutated concurrently from two directions: the caller's own thread
(via ``register()``/``unregister()`` on ``WebhookServerApi``) and the FastAPI
request-handling thread (reads on every inbound webhook). All mutation and
read methods therefore go through a single re-entrant lock.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass


@dataclass(frozen=True)
class WatchedFile:
    project_id: str
    file_area_id: str
    file_id: str


class WatchList:
    """Thread-safe, in-memory index of watched files, keyed by ``file_id``."""

    def __init__(self, files: list[WatchedFile] | None = None) -> None:
        self._lock = threading.RLock()
        self._by_id: dict[str, WatchedFile] = {f.file_id: f for f in (files or [])}

    @classmethod
    def load(cls, path: str) -> WatchList:
        """Load a watch list from a JSON file (see ``watchlist.example.json``)."""
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
        entries = raw.get("watch", []) if isinstance(raw, dict) else raw
        files = [
            WatchedFile(
                project_id=str(entry["project_id"]),
                file_area_id=str(entry["file_area_id"]),
                file_id=str(entry["file_id"]),
            )
            for entry in entries
        ]
        return cls(files)

    def save(self, path: str) -> None:
        """Persist the current watch list to a JSON file, for restart continuity."""
        with self._lock:
            entries = [
                {
                    "project_id": f.project_id,
                    "file_area_id": f.file_area_id,
                    "file_id": f.file_id,
                }
                for f in self._by_id.values()
            ]
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"watch": entries}, handle, indent=2)

    def add(self, watched_file: WatchedFile) -> None:
        with self._lock:
            self._by_id[watched_file.file_id] = watched_file

    def add_many(self, files: list[WatchedFile]) -> None:
        with self._lock:
            for f in files:
                self.add(f)

    def remove(self, file_id: str) -> None:
        with self._lock:
            self._by_id.pop(file_id, None)

    def remove_many(self, file_ids: list[str]) -> None:
        with self._lock:
            for file_id in file_ids:
                self.remove(file_id)

    def get(self, file_id: str) -> WatchedFile | None:
        with self._lock:
            return self._by_id.get(file_id)

    def is_watched(self, file_id: str) -> bool:
        with self._lock:
            return file_id in self._by_id

    def all(self) -> list[WatchedFile]:
        with self._lock:
            return list(self._by_id.values())

    def __len__(self) -> int:
        with self._lock:
            return len(self._by_id)
