"""Re-exports the Dalux file service from ``dalux_build.webhook_server``.

``DaluxService`` is kept as a backward-compatible alias for
``DaluxFileService``. Note its constructor now takes a ``FilesApi`` instance
(from an already-authenticated ``dalux_build`` client) plus a ``download_dir``
and ``Store``, rather than building its own client from ``Settings`` — see
``app.py``'s ``AppContext`` for how it's wired up in this package.
"""

from dalux_build.webhook_server.service import CheckResult, DaluxFileService

DaluxService = DaluxFileService

__all__ = ["CheckResult", "DaluxFileService", "DaluxService"]
