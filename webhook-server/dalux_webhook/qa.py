"""Outbound QA pipeline trigger — thin wrapper around ``dalux_build.webhook_server.qa``.

Keeps the ``trigger(settings, event)`` calling convention (this module's
``Settings`` has the QA fields, unlike the shared ``QaConfig``) so it can
still be monkeypatched by name in this package's own tests, while delegating
the actual HTTP/subprocess dispatch logic to the shared implementation.
"""

from __future__ import annotations

from dalux_build.json_types import JSONDict
from dalux_build.webhook_server.config import QaConfig
from dalux_build.webhook_server.qa import build_event
from dalux_build.webhook_server.qa import trigger as _shared_trigger

from .config import Settings

__all__ = ["build_event", "trigger"]


def trigger(settings: Settings, event: JSONDict) -> None:
    """Dispatch *event* to the configured QA mechanism."""
    _shared_trigger(
        QaConfig(
            qa_webhook_url=settings.qa_webhook_url,
            qa_webhook_token=settings.qa_webhook_token,
            qa_command=settings.qa_command,
        ),
        event,
    )
