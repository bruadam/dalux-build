"""Re-exports the watch list implementation from ``dalux_build.webhook_server``.

The logic lives in the ``dalux-build`` client package so the embedded
``DaluxClient.webhook_server`` sub-object and this standalone CLI service
share one implementation. See ``dalux_build.webhook_server.watchlist`` for
the actual code.
"""
from dalux_build.webhook_server.watchlist import WatchedFile, WatchList  # noqa: F401
