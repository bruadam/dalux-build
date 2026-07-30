"""Environment-driven defaults for the embedded webhook server.

Unlike the standalone ``webhook-server/`` CLI's ``Settings``, this dataclass
holds only webhook-specific runtime settings — no ``dalux_base_url`` /
``dalux_api_key`` fields, since those are already resolved on the parent
``DaluxClient``'s ``ApiClient`` by the time ``WebhookServerApi.start()`` runs.

Values here are defaults only: ``WebhookServerApi.start(**kwargs)`` overrides
whatever this returns.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from ..configuration import resolve_secret


def _get(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class QaConfig:
    """QA-trigger settings. Kept separate from ``qa.py`` (which imports
    ``httpx``) so it can be referenced eagerly by ``api.py`` without pulling
    in the optional webhook dependencies at package-import time."""

    qa_webhook_url: str = ""
    qa_webhook_token: str = ""
    qa_command: str = ""


@dataclass(frozen=True)
class WebhookRuntimeConfig:
    webhook_secret: str
    webhook_signature_header: str
    host: str
    port: int
    download_dir: str
    state_db_path: str
    watchlist_path: str
    qa_webhook_url: str
    qa_webhook_token: str
    qa_command: str

    @classmethod
    def from_env(cls) -> "WebhookRuntimeConfig":
        return cls(
            webhook_secret=resolve_secret("DALUX_WEBHOOK_SECRET", "") or "",
            webhook_signature_header=_get("DALUX_WEBHOOK_SIGNATURE_HEADER", "X-Dalux-Signature"),
            host=_get("HOST", "0.0.0.0"),
            port=int(_get("PORT", "8000") or "8000"),
            download_dir=_get("DOWNLOAD_DIR", "./downloads"),
            state_db_path=_get("STATE_DB_PATH", "./state.sqlite3"),
            watchlist_path=_get("WATCHLIST_PATH", ""),
            qa_webhook_url=_get("QA_WEBHOOK_URL"),
            qa_webhook_token=resolve_secret("QA_WEBHOOK_TOKEN", "") or "",
            qa_command=_get("QA_COMMAND"),
        )
