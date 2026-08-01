"""Re-exports change-detection helpers from ``dalux_build.webhook_server``.

See ``dalux_build.webhook_server.metadata`` for the actual code.
"""

from dalux_build.webhook_server.metadata import (
    etag_for,
    file_data,
    has_changed,
    to_state,
)

__all__ = ["etag_for", "file_data", "has_changed", "to_state"]
