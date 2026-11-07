"""Settings for reaching a self-hosted Dalux MCP platform.

Kept free of optional dependencies so it can be built before the ``rag``
extra is known to be installed.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from urllib.parse import quote

if TYPE_CHECKING:
    from langchain_mcp_adapters.sessions import StreamableHttpConnection


@dataclass(frozen=True)
class PlatformConfig:
    """Where the platform is and which token to call it with.

    *url* is the platform's base URL (e.g. ``https://dalux.example.com``).
    *connection* is a connection slug; without it the platform picks the
    token's connection, the account's default, or the only one it can reach.
    """

    url: str
    token: str = field(repr=False)
    connection: str | None = None

    @classmethod
    def from_env(
        cls,
        *,
        url: str | None = None,
        token: str | None = None,
        connection: str | None = None,
    ) -> PlatformConfig | None:
        """Build a config from arguments, falling back to ``DALUX_PLATFORM_*`` variables.

        Returns None when no platform URL is configured (local mode).
        """
        url = url or os.environ.get("DALUX_PLATFORM_URL")
        if not url:
            return None
        token = token or os.environ.get("DALUX_PLATFORM_TOKEN")
        if not token:
            raise ValueError(
                "A platform URL is configured but no token: pass platform_token or set "
                "DALUX_PLATFORM_TOKEN (a dxm_ API token or an OAuth access token)."
            )
        connection = connection or os.environ.get("DALUX_PLATFORM_CONNECTION") or None
        return cls(url=url.rstrip("/"), token=token, connection=connection)

    @property
    def mcp_url(self) -> str:
        if self.connection:
            return f"{self.url}/mcp/c/{quote(self.connection, safe='')}"
        return f"{self.url}/mcp"

    def mcp_connection(self) -> StreamableHttpConnection:
        """A ``langchain_mcp_adapters`` connection to the platform's MCP endpoint."""
        return {
            "transport": "streamable_http",
            "url": self.mcp_url,
            "headers": {"Authorization": f"Bearer {self.token}"},
        }

    def to_env(self) -> dict[str, str]:
        """Serialize for a subprocess; read back with :meth:`from_env`."""
        env = {"DALUX_PLATFORM_URL": self.url, "DALUX_PLATFORM_TOKEN": self.token}
        if self.connection:
            env["DALUX_PLATFORM_CONNECTION"] = self.connection
        return env
