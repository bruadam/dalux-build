"""Cross-document consistency checks through the Dalux MCP server.

Drives the server's consistency tools without a chat model in the loop:
``check_document_consistency`` until the report is complete, every page of
``list_inconsistencies``, then ``export_inconsistency_report``. The exported
document stays on the local machine; nothing is uploaded to Dalux.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal, TypedDict, cast

from .errors import ConsistencyCheckError, MissingAgentDependencies
from .mcp_server import MCP_SERVER_NAME, resolve_mcp_server_entrypoint, stdio_connection

if TYPE_CHECKING:
    from ... import DaluxClient

ReportFormat = Literal["xlsx", "docx", "md"]
CallTool = Callable[[str, dict[str, object]], Awaitable[dict[str, object]]]

_PAGE_SIZE = 100


class _StatementRequired(TypedDict):
    fileId: str
    fileName: str
    location: str
    quote: str


class Statement(_StatementRequired, total=False):
    """One document's side of an inconsistency, with its citable location."""

    revisionId: str
    value: str


class _FindingRequired(TypedDict):
    id: str
    type: str
    severity: str
    subject: str
    attribute: str
    summary: str
    verdict: str
    statements: list[Statement]


class Finding(_FindingRequired, total=False):
    """An inconsistency between at least two documents, as list_inconsistencies returns it."""

    explanation: str
    precedenceNote: str


@dataclass(frozen=True)
class ConsistencyReport:
    """A completed consistency check: its findings and the exported report file."""

    report_id: str
    summary: dict[str, object]
    findings: list[Finding]
    report_path: Path


async def run_consistency_check(
    call_tool: CallTool,
    *,
    project_id: str,
    file_area_id: str,
    folder_path: str | None = None,
    file_ids: list[str] | None = None,
    extensions: list[str] | None = None,
    focus: list[str] | None = None,
    max_files: int | None = None,
    time_budget_seconds: int | None = None,
    use_model: bool | None = None,
    report_format: ReportFormat = "xlsx",
) -> ConsistencyReport:
    """Run a consistency check to completion with *call_tool* calling MCP tools by name."""
    optional: dict[str, object | None] = {
        "folderPath": folder_path,
        "fileIds": file_ids,
        "extensions": extensions,
        "focus": focus,
        "maxFiles": max_files,
        "timeBudgetSeconds": time_budget_seconds,
        "useModel": use_model,
    }
    arguments: dict[str, object] = {
        "projectId": project_id,
        "fileAreaId": file_area_id,
        **{key: value for key, value in optional.items() if value is not None},
    }

    summary = await call_tool("check_document_consistency", arguments)
    while not summary.get("complete"):
        summary = await call_tool("check_document_consistency", arguments)
    report_id = str(summary["reportId"])

    findings: list[Finding] = []
    while True:
        page = await call_tool(
            "list_inconsistencies",
            {"reportId": report_id, "offset": len(findings), "limit": _PAGE_SIZE},
        )
        batch = cast(list[Finding], page["findings"])
        findings.extend(batch)
        if not batch or len(findings) >= cast(int, page["total"]):
            break

    exported = await call_tool(
        "export_inconsistency_report", {"reportId": report_id, "format": report_format}
    )
    file_path = exported.get("filePath")
    if not file_path:
        raise ConsistencyCheckError(
            f"export_inconsistency_report returned no file: {exported.get('message', exported)}"
        )
    return ConsistencyReport(
        report_id=report_id,
        summary=summary,
        findings=findings,
        report_path=Path(str(file_path)),
    )


async def _with_mcp_server(
    client: DaluxClient, run: Callable[[CallTool], Awaitable[ConsistencyReport]]
) -> ConsistencyReport:
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
        from mcp.types import TextContent
    except ImportError as exc:
        raise MissingAgentDependencies() from exc

    entrypoint = resolve_mcp_server_entrypoint()
    if entrypoint is None:
        raise ConsistencyCheckError(
            "The Dalux MCP server is not built. Run `npm run build` in mcp-server/ "
            "or set DALUX_MCP_SERVER_PATH to its dist/cli.js."
        )
    env = {
        **os.environ,
        "DALUX_BASE_URL": client.configuration.base_url,
        "DALUX_API_KEY": client.configuration.api_key,
    }
    mcp_client = MultiServerMCPClient({MCP_SERVER_NAME: stdio_connection(entrypoint, env)})
    async with mcp_client.session(MCP_SERVER_NAME) as session:

        async def call_tool(name: str, arguments: dict[str, object]) -> dict[str, object]:
            result = await session.call_tool(name, arguments)
            text = "".join(block.text for block in result.content if isinstance(block, TextContent))
            if result.isError:
                raise ConsistencyCheckError(f"{name} failed: {text}")
            return cast(dict[str, object], json.loads(text))

        return await run(call_tool)


def check_consistency(
    client: DaluxClient,
    project_id: str,
    file_area_id: str,
    *,
    folder_path: str | None = None,
    file_ids: list[str] | None = None,
    extensions: list[str] | None = None,
    focus: list[str] | None = None,
    max_files: int | None = None,
    time_budget_seconds: int | None = None,
    use_model: bool | None = None,
    report_format: ReportFormat = "xlsx",
) -> ConsistencyReport:
    """Start the Dalux MCP server over stdio and run a consistency check to completion."""

    def run(call_tool: CallTool) -> Awaitable[ConsistencyReport]:
        return run_consistency_check(
            call_tool,
            project_id=project_id,
            file_area_id=file_area_id,
            folder_path=folder_path,
            file_ids=file_ids,
            extensions=extensions,
            focus=focus,
            max_files=max_files,
            time_budget_seconds=time_budget_seconds,
            use_model=use_model,
            report_format=report_format,
        )

    return asyncio.run(_with_mcp_server(client, run))
