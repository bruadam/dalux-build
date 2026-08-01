"""Embedded webhook receiver for ``DaluxClient``.

::

    from dalux_build import create_client

    dalux = create_client()
    dalux.webhook_server.start()
    dalux.webhook_server.register(project_id="p1", file_area_id="fa1", file_ids=["id1"])
    dalux.webhook_server.stop()

Requires the ``webhook`` extra (``pip install dalux-build[webhook]``) to
actually start a server; importing this package itself has no such
requirement — ``fastapi``/``uvicorn``/``httpx`` are only imported lazily
inside :meth:`WebhookServerApi.start`.
"""

from .api import WebhookServerApi
from .errors import (
    MissingWebhookDependencies,
    WebhookServerAlreadyRunning,
    WebhookServerError,
    WebhookServerNotRunning,
)
from .watchlist import WatchedFile, WatchList

__all__ = [
    "WebhookServerApi",
    "WatchedFile",
    "WatchList",
    "WebhookServerError",
    "WebhookServerAlreadyRunning",
    "WebhookServerNotRunning",
    "MissingWebhookDependencies",
]
