"""Errors raised by the embedded webhook server."""
from __future__ import annotations


class WebhookServerError(Exception):
    """Base class for webhook_server errors."""


class WebhookServerAlreadyRunning(WebhookServerError):
    """Raised by ``start()`` when the server is already running."""


class WebhookServerNotRunning(WebhookServerError):
    """Raised when an operation requires a running server."""


class MissingWebhookDependencies(WebhookServerError, ImportError):
    """Raised when fastapi/uvicorn/httpx are not installed.

    Inherits from ``ImportError`` so callers can catch either the specific
    error or ``ImportError`` generically.
    """

    def __init__(self, message: str = "") -> None:
        super().__init__(
            message
            or "webhook_server requires the 'webhook' extra: "
            "pip install 'dalux-build[webhook]'"
        )
