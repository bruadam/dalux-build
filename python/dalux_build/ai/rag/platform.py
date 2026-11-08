"""Retrieval through a self-hosted Dalux MCP platform instead of a local vector store.

The platform serves the shared document, task and reference-docs indexes as
MCP search tools (``search_file_area``, ``search_task_index``, ``search_docs``)
over streamable HTTP. Every call carries a bearer token (a ``dxm_`` API token
or an OAuth access token), so the platform's access rules decide which
passages come back: use a person's own token when the agent works for that
person, and a robot token only for unattended jobs.
"""

from __future__ import annotations

import asyncio
import json
from typing import Literal, cast

import httpx
from langchain_core.callbacks import (
    AsyncCallbackManagerForRetrieverRun,
    CallbackManagerForRetrieverRun,
)
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever

from ..platform_config import PlatformConfig

SearchTool = Literal["search_file_area", "search_task_index", "search_docs", "memory_search"]

MemoryKind = Literal["fact", "decision", "preference", "open_question", "summary"]

PLATFORM_SERVER_NAME = "dalux-platform"


class PlatformError(RuntimeError):
    """A platform MCP tool call failed (bad token, no access, missing index, ...)."""


def _http_error(error: BaseException) -> httpx.HTTPStatusError | None:
    """The HTTP error behind a failed call; the MCP client wraps it in exception groups."""
    if isinstance(error, httpx.HTTPStatusError):
        return error
    nested: tuple[BaseException, ...] = getattr(error, "exceptions", ())
    return next((found for e in nested if (found := _http_error(e))), None)


async def call_platform_tool(
    platform: PlatformConfig, name: str, arguments: dict[str, object]
) -> dict[str, object]:
    """Call one platform MCP tool and return its JSON result."""
    from langchain_mcp_adapters.client import MultiServerMCPClient
    from mcp.types import TextContent

    client = MultiServerMCPClient({PLATFORM_SERVER_NAME: platform.mcp_connection()})
    try:
        async with client.session(PLATFORM_SERVER_NAME) as session:
            result = await session.call_tool(name, arguments)
    except Exception as exc:
        error = _http_error(exc)
        if error is None:
            raise
        status = error.response.status_code
        hint = " (check the platform token)" if status in (401, 403) else ""
        raise PlatformError(f"{platform.mcp_url} answered HTTP {status}{hint}") from exc
    text = "".join(block.text for block in result.content if isinstance(block, TextContent))
    if result.isError:
        raise PlatformError(f"{name} failed: {text}")
    return cast(dict[str, object], json.loads(text))


def documents_from_matches(tool: SearchTool, matches: list[dict[str, object]]) -> list[Document]:
    """Turn search matches into Documents with the metadata the agent cites.

    ``file_id``/``file_name`` as in the local store, ``page`` 0-based like
    PyPDFLoader (the tools report 1-based pages), plus ``location`` for
    passages without a page (a spreadsheet range, a section, a task field).
    """
    documents = []
    for match in matches:
        if tool == "memory_search":
            file_id = str(match["id"])
            file_name = f"Memory ({match['kind']})"
        elif tool == "search_task_index":
            number = match.get("number")
            subject = str(match["subject"])
            file_id = str(match["taskId"])
            file_name = f"Task {number}: {subject}" if number else subject
        elif tool == "search_docs":
            file_id = file_name = str(match["path"])
        else:
            file_id, file_name = str(match["fileId"]), str(match["fileName"])
        metadata: dict[str, object] = {
            "file_id": file_id,
            "file_name": file_name,
            "source": file_name,
            "location": match.get("location"),
            "score": match.get("score"),
        }
        if tool == "memory_search":
            metadata["memory"] = True
            metadata["written_by"] = match.get("source")
        page = match.get("page")
        if isinstance(page, int):
            metadata["page"] = page - 1
        documents.append(Document(page_content=str(match["text"]), metadata=metadata))
    return documents


class PlatformRetriever(BaseRetriever):  # type: ignore[explicit-any]  # pydantic model
    """LangChain retriever over one of the platform's MCP search tools.

    *arguments* address the index, as the tool expects: e.g.
    ``{"projectId": ..., "fileAreaId": ...}`` or ``{"indexId": ...}`` for
    ``search_file_area``; ``{"projectId": ...}`` for ``search_task_index``;
    nothing for ``search_docs``.

    With *memory* on (and a ``projectId`` in *arguments*) every search also
    returns the person's saved project memory, marked ``memory=True`` in the
    metadata; a project with memory off adds nothing. :meth:`write_memory`
    saves a note, which the platform refuses while memory is off.
    """

    platform: PlatformConfig
    tool: SearchTool = "search_file_area"
    arguments: dict[str, object] = {}
    top_k: int = 6
    memory: bool = False

    async def asearch(self, query: str, *, top_k: int | None = None) -> list[Document]:
        k = top_k or self.top_k
        result = await call_platform_tool(
            self.platform, self.tool, {**self.arguments, "query": query, "topK": k}
        )
        documents = documents_from_matches(
            self.tool, cast(list[dict[str, object]], result["matches"])
        )
        if self.memory and "projectId" in self.arguments:
            remembered = await call_platform_tool(
                self.platform,
                "memory_search",
                {"projectId": self.arguments["projectId"], "query": query, "topK": min(k, 8)},
            )
            documents += documents_from_matches(
                "memory_search", cast(list[dict[str, object]], remembered.get("matches", []))
            )
        return documents

    async def awrite_memory(
        self,
        text: str,
        *,
        kind: MemoryKind = "fact",
        citations: list[dict[str, str]] | None = None,
        tags: list[str] | None = None,
    ) -> bool:
        """Save a note to the person's project memory. False when memory is off for the project."""
        arguments: dict[str, object] = {
            "projectId": self.arguments["projectId"],
            "kind": kind,
            "text": text,
        }
        if citations:
            arguments["citations"] = citations
        if tags:
            arguments["tags"] = tags
        result = await call_platform_tool(self.platform, "memory_write", arguments)
        return result.get("saved") is True

    def write_memory(
        self,
        text: str,
        *,
        kind: MemoryKind = "fact",
        citations: list[dict[str, str]] | None = None,
        tags: list[str] | None = None,
    ) -> bool:
        return asyncio.run(self.awrite_memory(text, kind=kind, citations=citations, tags=tags))

    def search(self, query: str, *, top_k: int | None = None) -> list[Document]:
        return asyncio.run(self.asearch(query, top_k=top_k))

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> list[Document]:
        return self.search(query)

    async def _aget_relevant_documents(
        self, query: str, *, run_manager: AsyncCallbackManagerForRetrieverRun
    ) -> list[Document]:
        return await self.asearch(query)
