"""The set of files the service reacts to.

A watch list is a small JSON document mapping each watched file to the
``project_id`` / ``file_area_id`` needed to call the Dalux Build API. Webhook
events for files that are not on the list are ignored, and the poller only
checks files on the list.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class WatchedFile:
    project_id: str
    file_area_id: str
    file_id: str


class WatchList:
    """In-memory index of watched files, keyed by ``file_id``."""

    def __init__(self, files: List[WatchedFile]) -> None:
        self._by_id: Dict[str, WatchedFile] = {f.file_id: f for f in files}

    @classmethod
    def load(cls, path: str) -> "WatchList":
        with open(path, "r", encoding="utf-8") as handle:
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

    def get(self, file_id: str) -> Optional[WatchedFile]:
        return self._by_id.get(file_id)

    def is_watched(self, file_id: str) -> bool:
        return file_id in self._by_id

    def all(self) -> List[WatchedFile]:
        return list(self._by_id.values())

    def __len__(self) -> int:
        return len(self._by_id)
