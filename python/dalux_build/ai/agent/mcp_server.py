"""Connection settings for the TypeScript Dalux MCP server (mcp-server/).

Shared by the agent graph, which loads its tools, and by
``dalux_build.ai.consistency``, which calls the consistency tools directly.
MCP's stdio transport is plain JSON-RPC over stdin/stdout, so the server
being written in TypeScript doesn't matter here.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from langchain_mcp_adapters.sessions import StdioConnection

MCP_SERVER_NAME = "dalux-api"


def resolve_mcp_server_entrypoint() -> Path | None:
    """Locate the built dalux-mcp CLI (mcp-server/dist/cli.js).

    Looks next to this monorepo checkout by default
    (python/dalux_build/ai/agent/mcp_server.py -> repo root is 4 parents up);
    override with DALUX_MCP_SERVER_PATH when running outside that layout.
    Returns None if the server hasn't been built.
    """
    override = os.environ.get("DALUX_MCP_SERVER_PATH")
    if override:
        path = Path(override)
        return path if path.exists() else None
    repo_root = Path(__file__).resolve().parents[4]
    candidate = repo_root / "mcp-server" / "dist" / "cli.js"
    return candidate if candidate.exists() else None


def stdio_connection(entrypoint: Path, env: dict[str, str]) -> StdioConnection:
    """A ``langchain_mcp_adapters`` stdio connection that starts the server with *env*."""
    return {
        "transport": "stdio",
        "command": "node",
        "args": [str(entrypoint), "--transport", "stdio"],
        "env": env,
    }
