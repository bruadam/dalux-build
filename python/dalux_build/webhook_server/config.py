"""Configuration for the scheduled monitor."""

from __future__ import annotations

import os
from dataclasses import dataclass

from ..configuration import resolve_secret


@dataclass(frozen=True)
class MonitorConfig:
    management_token: str
    master_key: str
    default_base_url: str = ""
    default_timezone: str = "UTC"
    state_db_path: str = "./state.sqlite3"
    host: str = "127.0.0.1"
    port: int = 8000
    max_delivery_attempts: int = 8

    @classmethod
    def from_env(cls) -> MonitorConfig:
        return cls(
            management_token=resolve_secret("MONITOR_API_TOKEN", "") or "",
            master_key=resolve_secret("MONITOR_MASTER_KEY", "") or "",
            default_base_url=os.getenv("DALUX_BASE_URL", "").strip(),
            default_timezone=os.getenv("MONITOR_TIMEZONE", "UTC").strip(),
            state_db_path=os.getenv("STATE_DB_PATH", "./state.sqlite3").strip(),
            host=os.getenv("HOST", "127.0.0.1").strip(),
            port=int(os.getenv("PORT", "8000")),
            max_delivery_attempts=int(os.getenv("WEBHOOK_MAX_ATTEMPTS", "8")),
        )

    def validate(self) -> None:
        if not self.management_token:
            raise ValueError("MONITOR_API_TOKEN or MONITOR_API_TOKEN_FILE is required")
        if not self.master_key:
            raise ValueError("MONITOR_MASTER_KEY or MONITOR_MASTER_KEY_FILE is required")
