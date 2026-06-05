"""Environment-driven configuration for the webhook server."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


def _get(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    """All runtime settings, loaded from environment variables.

    Secrets (the Dalux API key, the webhook signing secret, the QA token) are
    read server-side only and never returned to webhook callers.
    """

    dalux_base_url: str
    dalux_api_key: str
    webhook_secret: str
    webhook_signature_header: str
    watchlist_path: str
    state_db_path: str
    download_dir: str
    qa_webhook_url: str
    qa_webhook_token: str
    qa_command: str
    host: str
    port: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            dalux_base_url=_get("DALUX_BASE_URL"),
            dalux_api_key=_get("DALUX_API_KEY"),
            webhook_secret=_get("DALUX_WEBHOOK_SECRET"),
            webhook_signature_header=_get("DALUX_WEBHOOK_SIGNATURE_HEADER", "X-Dalux-Signature"),
            watchlist_path=_get("WATCHLIST_PATH", "./watchlist.json"),
            state_db_path=_get("STATE_DB_PATH", "./state.sqlite3"),
            download_dir=_get("DOWNLOAD_DIR", "./downloads"),
            qa_webhook_url=_get("QA_WEBHOOK_URL"),
            qa_webhook_token=_get("QA_WEBHOOK_TOKEN"),
            qa_command=_get("QA_COMMAND"),
            host=_get("HOST", "0.0.0.0"),
            port=int(_get("PORT", "8000") or "8000"),
        )

    def require_dalux(self) -> None:
        """Validate the settings needed to talk to Dalux are present."""
        missing = [
            name
            for name, value in (
                ("DALUX_BASE_URL", self.dalux_base_url),
                ("DALUX_API_KEY", self.dalux_api_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(
                "Missing required environment variables: " + ", ".join(missing)
            )


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Return process-wide settings, loaded once from the environment."""
    global _settings
    if _settings is None:
        _settings = Settings.from_env()
    return _settings
