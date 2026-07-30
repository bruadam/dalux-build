"""Persistent state: last-seen revision per file and processed event ids.

Uses SQLite so a single-process deployment keeps working across restarts
without an external database. Swap this class for a Postgres/Redis-backed
implementation if you need multi-instance deployments.
"""
from __future__ import annotations

import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Optional


@dataclass
class FileState:
    file_id: str
    revision_id: Optional[str]
    content_hash: Optional[str]
    last_modified: Optional[str]
    file_size: Optional[int]
    downloaded_path: Optional[str]
    updated_at: float


_SCHEMA = """
CREATE TABLE IF NOT EXISTS file_state (
    file_id        TEXT PRIMARY KEY,
    revision_id    TEXT,
    content_hash   TEXT,
    last_modified  TEXT,
    file_size      INTEGER,
    downloaded_path TEXT,
    updated_at     REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_events (
    event_id    TEXT PRIMARY KEY,
    received_at REAL NOT NULL
);
"""


class Store:
    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._conn:
            self._conn.executescript(_SCHEMA)

    def get_state(self, file_id: str) -> Optional[FileState]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM file_state WHERE file_id = ?", (file_id,)
            ).fetchone()
        if row is None:
            return None
        return FileState(
            file_id=row["file_id"],
            revision_id=row["revision_id"],
            content_hash=row["content_hash"],
            last_modified=row["last_modified"],
            file_size=row["file_size"],
            downloaded_path=row["downloaded_path"],
            updated_at=row["updated_at"],
        )

    def save_state(self, state: FileState) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO file_state
                    (file_id, revision_id, content_hash, last_modified,
                     file_size, downloaded_path, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(file_id) DO UPDATE SET
                    revision_id=excluded.revision_id,
                    content_hash=excluded.content_hash,
                    last_modified=excluded.last_modified,
                    file_size=excluded.file_size,
                    downloaded_path=excluded.downloaded_path,
                    updated_at=excluded.updated_at
                """,
                (
                    state.file_id,
                    state.revision_id,
                    state.content_hash,
                    state.last_modified,
                    state.file_size,
                    state.downloaded_path,
                    state.updated_at,
                ),
            )

    def mark_event(self, event_id: str) -> bool:
        """Record an event id. Returns True if newly recorded, False if a duplicate.

        Used for idempotency so webhook retries do not re-trigger QA.
        """
        try:
            with self._lock, self._conn:
                self._conn.execute(
                    "INSERT INTO processed_events (event_id, received_at) VALUES (?, ?)",
                    (event_id, time.time()),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def close(self) -> None:
        with self._lock:
            self._conn.close()
