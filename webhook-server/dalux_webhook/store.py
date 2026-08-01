"""Re-exports the state store from ``dalux_build.webhook_server``.

See ``dalux_build.webhook_server.store`` for the actual code.
"""

from dalux_build.webhook_server.store import FileState, Store

__all__ = ["FileState", "Store"]
