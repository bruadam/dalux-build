"""SQLite persistence for monitor jobs, snapshots, state, runs and deliveries."""

from __future__ import annotations

import gzip
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import cast

from ..json_types import JSONDict

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS jobs (
 job_id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, project_id TEXT NOT NULL,
 file_area_id TEXT NOT NULL, base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL,
 cron TEXT NOT NULL, timezone TEXT NOT NULL, callback_url TEXT NOT NULL,
 callback_auth_type TEXT NOT NULL, callback_secret_encrypted TEXT,
 test_callback_url TEXT, test_callback_auth_type TEXT, test_callback_secret_encrypted TEXT,
 config_json TEXT NOT NULL, next_run_at TEXT NOT NULL, running INTEGER NOT NULL DEFAULT 0,
 initialized INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
 idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS file_state (
 job_id TEXT NOT NULL, file_id TEXT NOT NULL, data_json TEXT NOT NULL,
 PRIMARY KEY(job_id,file_id), FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS latest_snapshots (
 job_id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, pages_gzip BLOB NOT NULL,
 FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS runs (
 run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, scheduled_at TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, detail TEXT,
 FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS deliveries (
 delivery_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, payload_json TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', last_error TEXT,
 FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Store:
    def __init__(self, db_path: str) -> None:
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._conn:
            columns = {
                row[1] for row in self._conn.execute("PRAGMA table_info(file_state)").fetchall()
            }
            if columns and "job_id" not in columns:
                self._conn.executescript(
                    "DROP TABLE IF EXISTS file_state; DROP TABLE IF EXISTS processed_events;"
                )
            self._conn.executescript(SCHEMA)
            job_columns = {
                row[1] for row in self._conn.execute("PRAGMA table_info(jobs)").fetchall()
            }
            if "enabled" not in job_columns:
                self._conn.execute("ALTER TABLE jobs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
            if "test_callback_url" not in job_columns:
                self._conn.executescript(
                    "ALTER TABLE jobs ADD COLUMN test_callback_url TEXT;"
                    "ALTER TABLE jobs ADD COLUMN test_callback_auth_type TEXT;"
                    "ALTER TABLE jobs ADD COLUMN test_callback_secret_encrypted TEXT;"
                )
            self._conn.execute("UPDATE jobs SET running=0")

    def create_job(self, values: dict[str, object]) -> bool:
        columns = ",".join(values)
        placeholders = ",".join("?" for _ in values)
        try:
            with self._lock, self._conn:
                self._conn.execute(
                    f"INSERT INTO jobs ({columns}) VALUES ({placeholders})", tuple(values.values())
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def job_by_idempotency(self, key: str) -> sqlite3.Row | None:
        with self._lock:
            return cast(
                sqlite3.Row | None,
                self._conn.execute("SELECT * FROM jobs WHERE idempotency_key=?", (key,)).fetchone(),
            )

    def get_job(self, job_id: str) -> sqlite3.Row | None:
        with self._lock:
            return cast(
                sqlite3.Row | None,
                self._conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone(),
            )

    def all_jobs(self) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute("SELECT * FROM jobs ORDER BY created_at"))

    def due_jobs(self, now: datetime) -> list[sqlite3.Row]:
        with self._lock:
            return list(
                self._conn.execute(
                    "SELECT * FROM jobs WHERE next_run_at<=? AND running=0 AND enabled=1",
                    (now.isoformat(),),
                )
            )

    def set_enabled(self, job_id: str, enabled: bool, next_run_at: datetime | None = None) -> bool:
        with self._lock, self._conn:
            if next_run_at is not None:
                cur = self._conn.execute(
                    "UPDATE jobs SET enabled=?, next_run_at=? WHERE job_id=?",
                    (1 if enabled else 0, next_run_at.isoformat(), job_id),
                )
            else:
                cur = self._conn.execute(
                    "UPDATE jobs SET enabled=? WHERE job_id=?", (1 if enabled else 0, job_id)
                )
            return cur.rowcount == 1

    def claim(self, job_id: str, following: datetime) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "UPDATE jobs SET running=1,next_run_at=? WHERE job_id=? AND running=0",
                (following.isoformat(), job_id),
            )
            return cur.rowcount == 1

    def release(self, job_id: str, next_if_missed: datetime | None = None) -> None:
        with self._lock, self._conn:
            if next_if_missed is None:
                self._conn.execute("UPDATE jobs SET running=0 WHERE job_id=?", (job_id,))
                return
            self._conn.execute(
                "UPDATE jobs SET running=0, next_run_at=CASE "
                "WHEN next_run_at<=? THEN ? ELSE next_run_at END WHERE job_id=?",
                (utcnow().isoformat(), next_if_missed.isoformat(), job_id),
            )

    def start_run(self, job_id: str, scheduled_at: datetime) -> str:
        run_id = str(uuid.uuid4())
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO runs(run_id,job_id,scheduled_at,started_at,status) VALUES(?,?,?,?,?)",
                (run_id, job_id, scheduled_at.isoformat(), utcnow().isoformat(), "running"),
            )
        return run_id

    def finish_run(self, run_id: str, status: str, detail: str = "") -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE runs SET finished_at=?,status=?,detail=? WHERE run_id=?",
                (utcnow().isoformat(), status, detail[:2000], run_id),
            )

    def delete_job(self, job_id: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM jobs WHERE job_id=?", (job_id,))

    def states(self, job_id: str) -> dict[str, JSONDict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT file_id,data_json FROM file_state WHERE job_id=?", (job_id,)
            )
            return {row["file_id"]: cast(JSONDict, json.loads(row["data_json"])) for row in rows}

    def commit_poll(
        self,
        job_id: str,
        pages: list[JSONDict],
        states: dict[str, JSONDict],
        delivery: tuple[str, JSONDict] | None,
    ) -> None:
        now = utcnow().isoformat()
        raw = gzip.compress(json.dumps(pages, separators=(",", ":")).encode())
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM file_state WHERE job_id=?", (job_id,))
            self._conn.executemany(
                "INSERT INTO file_state(job_id,file_id,data_json) VALUES(?,?,?)",
                [
                    (job_id, fid, json.dumps(data, separators=(",", ":")))
                    for fid, data in states.items()
                ],
            )
            self._conn.execute(
                "INSERT INTO latest_snapshots(job_id,fetched_at,pages_gzip) VALUES(?,?,?) "
                "ON CONFLICT(job_id) DO UPDATE SET "
                "fetched_at=excluded.fetched_at,pages_gzip=excluded.pages_gzip",
                (job_id, now, raw),
            )
            self._conn.execute("UPDATE jobs SET initialized=1 WHERE job_id=?", (job_id,))
            if delivery:
                self._conn.execute(
                    "INSERT INTO deliveries"
                    "(delivery_id,job_id,payload_json,next_attempt_at) VALUES(?,?,?,?)",
                    (delivery[0], job_id, json.dumps(delivery[1], separators=(",", ":")), now),
                )

    def pending_deliveries(self, now: datetime) -> list[sqlite3.Row]:
        with self._lock:
            return list(
                self._conn.execute(
                    "SELECT d.*,j.callback_url,j.callback_auth_type,j.callback_secret_encrypted "
                    "FROM deliveries d JOIN jobs j USING(job_id) "
                    "WHERE d.status='pending' AND d.next_attempt_at<=? ORDER BY d.next_attempt_at",
                    (now.isoformat(),),
                )
            )

    def delivery_result(
        self, delivery_id: str, *, success: bool, attempts: int, next_at: datetime, error: str = ""
    ) -> None:
        status = "delivered" if success else "pending"
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE deliveries SET status=?,attempts=?,next_attempt_at=?,last_error=? "
                "WHERE delivery_id=?",
                (status, attempts, next_at.isoformat(), error[:1000], delivery_id),
            )

    def fail_delivery(self, delivery_id: str, attempts: int, error: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE deliveries SET status='failed',attempts=?,last_error=? WHERE delivery_id=?",
                (attempts, error[:1000], delivery_id),
            )

    def failed_count(self) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT count(*) AS n FROM deliveries WHERE status='failed'"
            ).fetchone()
            return int(row["n"]) if row else 0

    def close(self) -> None:
        with self._lock:
            self._conn.close()
