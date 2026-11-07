"""The platform retriever against a fake platform MCP endpoint over streamable HTTP."""

import json
import socket
import threading
import time

import pytest

pytest.importorskip("langchain_mcp_adapters")
pytest.importorskip("uvicorn")
import uvicorn
from langchain_core.documents import Document
from langchain_core.messages import AIMessage
from mcp.server.fastmcp import FastMCP

from dalux_build.ai.platform_config import PlatformConfig
from dalux_build.ai.rag.adaptive import Grade, Route, build_adaptive_rag, citation_label
from dalux_build.ai.rag.platform import PlatformError, PlatformRetriever

TOKEN = "dxm_test-token"


def _fake_platform(calls: list[dict[str, object]]) -> FastMCP:
    """The platform's search tools with canned matches, in the shapes the TS tools return."""
    mcp = FastMCP("fake-platform", stateless_http=True, json_response=True)

    @mcp.tool()
    def search_file_area(
        query: str,
        projectId: str | None = None,  # noqa: N803 - MCP argument names
        fileAreaId: str | None = None,  # noqa: N803
        folderId: str | None = None,  # noqa: N803
        indexId: str | None = None,  # noqa: N803
        topK: int | None = None,  # noqa: N803
    ) -> str:
        calls.append(
            {
                "tool": "search_file_area",
                "query": query,
                "projectId": projectId,
                "fileAreaId": fileAreaId,
                "folderId": folderId,
                "indexId": indexId,
                "topK": topK,
            }
        )
        if query == "missing":
            raise ValueError("No index for this scope")
        matches = [
            {
                "fileId": "F1",
                "fileName": "fire.pdf",
                "location": "p. 3",
                "page": 3,
                "text": "Doors are EI 60.",
                "score": 0.91,
            },
            {
                "fileId": "F2",
                "fileName": "budget.xlsx",
                "location": "Budget!rows 40-58",
                "page": None,
                "text": "Doors: 120 pcs.",
                "score": 0.72,
            },
        ]
        return json.dumps({"mode": "hybrid", "query": query, "matches": matches[: topK or 8]})

    @mcp.tool()
    def search_task_index(query: str, projectId: str | None = None, topK: int | None = None) -> str:  # noqa: N803
        calls.append({"tool": "search_task_index", "projectId": projectId, "topK": topK})
        match = {
            "taskId": "T9",
            "subject": "Missing fire seal",
            "number": "42",
            "usage": "Defect",
            "location": "history 2",
            "text": "Fire seal missing at door 3.",
            "score": 0.8,
        }
        return json.dumps({"matches": [match]})

    @mcp.tool()
    def search_docs(query: str, topK: int | None = None) -> str:  # noqa: N803
        calls.append({"tool": "search_docs", "topK": topK})
        match = {
            "path": "laws/br18.md",
            "page": None,
            "location": "§ 4.2 Fire",
            "text": "Escape routes must ...",
            "score": 0.7,
        }
        return json.dumps({"matches": [match]})

    @mcp.tool()
    def check_document_consistency(projectId: str, fileAreaId: str) -> str:  # noqa: N803
        return json.dumps({"reportId": "R1"})

    return mcp


@pytest.fixture
def platform():
    """Serve the fake platform at /mcp and /mcp/c/<slug>, behind a bearer token check."""
    calls: list[dict[str, object]] = []
    paths: list[str] = []
    mcp_app = _fake_platform(calls).streamable_http_app()

    async def app(scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope["headers"])
            if headers.get(b"authorization") != f"Bearer {TOKEN}".encode():
                await send({"type": "http.response.start", "status": 401, "headers": []})
                await send({"type": "http.response.body", "body": b"unauthorized"})
                return
            paths.append(scope["path"])
            scope = {**scope, "path": "/mcp", "raw_path": b"/mcp"}
        await mcp_app(scope, receive, send)

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.01)
    yield f"http://127.0.0.1:{port}", calls, paths
    server.should_exit = True
    thread.join(timeout=5)


def test_config_from_env_and_arguments(monkeypatch):
    for name in ("DALUX_PLATFORM_URL", "DALUX_PLATFORM_TOKEN", "DALUX_PLATFORM_CONNECTION"):
        monkeypatch.delenv(name, raising=False)
    assert PlatformConfig.from_env() is None

    monkeypatch.setenv("DALUX_PLATFORM_URL", "https://dalux.example.com/")
    with pytest.raises(ValueError, match="DALUX_PLATFORM_TOKEN"):
        PlatformConfig.from_env()

    monkeypatch.setenv("DALUX_PLATFORM_TOKEN", "dxm_env")
    config = PlatformConfig.from_env()
    assert config is not None
    assert config.mcp_url == "https://dalux.example.com/mcp"
    assert "dxm_env" not in repr(config)

    config = PlatformConfig.from_env(token="oauth-access", connection="site a")
    assert config is not None
    assert config.mcp_url == "https://dalux.example.com/mcp/c/site%20a"
    assert config.mcp_connection()["headers"] == {"Authorization": "Bearer oauth-access"}

    monkeypatch.delenv("DALUX_PLATFORM_URL")
    monkeypatch.delenv("DALUX_PLATFORM_TOKEN")
    for name, value in config.to_env().items():
        monkeypatch.setenv(name, value)
    assert PlatformConfig.from_env() == config


def test_file_area_search_returns_citable_documents(platform):
    url, calls, paths = platform
    retriever = PlatformRetriever(
        platform=PlatformConfig(url=url, token=TOKEN, connection="site-a"),
        arguments={"projectId": "P1", "fileAreaId": "FA1"},
    )

    documents = retriever.invoke("door fire rating")

    assert paths and set(paths) == {"/mcp/c/site-a"}
    assert calls == [
        {
            "tool": "search_file_area",
            "query": "door fire rating",
            "projectId": "P1",
            "fileAreaId": "FA1",
            "folderId": None,
            "indexId": None,
            "topK": 6,
        }
    ]
    assert [citation_label(d.metadata) for d in documents] == [
        "fire.pdf, page 3",
        "budget.xlsx, Budget!rows 40-58",
    ]
    assert documents[0].page_content == "Doors are EI 60."
    assert documents[0].metadata["file_id"] == "F1"
    assert documents[0].metadata["page"] == 2  # 0-based, like PyPDFLoader
    assert "page" not in documents[1].metadata


def test_task_and_docs_search(platform):
    url, calls, _ = platform
    config = PlatformConfig(url=url, token=TOKEN)

    tasks = PlatformRetriever(
        platform=config, tool="search_task_index", arguments={"projectId": "P1"}
    ).search("fire seal", top_k=3)
    docs = PlatformRetriever(platform=config, tool="search_docs").invoke("escape routes")

    assert calls == [
        {"tool": "search_task_index", "projectId": "P1", "topK": 3},
        {"tool": "search_docs", "topK": 6},
    ]
    assert citation_label(tasks[0].metadata) == "Task 42: Missing fire seal, history 2"
    assert tasks[0].metadata["file_id"] == "T9"
    assert citation_label(docs[0].metadata) == "laws/br18.md, § 4.2 Fire"


def test_tool_errors_raise_platform_error(platform):
    url, _, _ = platform
    retriever = PlatformRetriever(platform=PlatformConfig(url=url, token=TOKEN))
    with pytest.raises(PlatformError, match="No index for this scope"):
        retriever.invoke("missing")


def test_wrong_token_is_rejected(platform):
    url, calls, _ = platform
    retriever = PlatformRetriever(platform=PlatformConfig(url=url, token="dxm_wrong"))
    with pytest.raises(PlatformError, match="HTTP 401 \\(check the platform token\\)"):
        retriever.invoke("door fire rating")
    assert calls == []


class _Model:
    """Grades everything relevant and grounded, and records the prompt it answers from."""

    def __init__(self) -> None:
        self.prompts: list[str] = []

    def with_structured_output(self, schema):
        def invoke(messages):
            if schema is Route:
                return Route(datasource="vectorstore")
            if schema is Grade:
                return Grade(yes=True)
            return schema(grounded=True, useful=True)

        return type("Structured", (), {"invoke": staticmethod(invoke)})()

    def invoke(self, messages):
        self.prompts.append(str(messages))
        return AIMessage(content="Doors are EI 60 [fire.pdf, page 3].")


def test_adaptive_rag_runs_on_the_platform_retriever(platform):
    url, _, _ = platform
    retriever = PlatformRetriever(
        platform=PlatformConfig(url=url, token=TOKEN),
        arguments={"projectId": "P1", "fileAreaId": "FA1"},
    )
    model = _Model()

    rag = build_adaptive_rag(model, retriever.invoke)  # type: ignore[arg-type]
    answer = rag("What fire rating do doors have?")

    assert "[fire.pdf, page 3]" in answer
    assert "fire.pdf, page 3" in model.prompts[0]
    assert "budget.xlsx, Budget!rows 40-58" in model.prompts[0]


def test_agent_tools_use_the_platform_when_configured(platform, monkeypatch):
    pytest.importorskip("langchain_mistralai")
    from dalux_build.ai.agent import graph_runtime as runtime

    url, calls, _ = platform
    for name, value in PlatformConfig(url=url, token=TOKEN).to_env().items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("DALUX_PLATFORM_CONNECTION", raising=False)
    monkeypatch.delenv("DALUX_AGENT_CACHE_KEY", raising=False)
    monkeypatch.setenv("DALUX_AGENT_PROJECT_ID", "P1")
    monkeypatch.setenv("DALUX_AGENT_FILE_AREA_ID", "FA1")
    monkeypatch.setenv("DALUX_AGENT_FOLDER_ID", "D1")
    monkeypatch.setattr(runtime, "_build_chat_model", _Model)

    tools = {tool.name: tool for tool in runtime._build_retriever_tools()}
    compared = tools["compare_dalux_documents"].invoke({"query": "doors"})
    answered = tools["search_dalux_documents"].invoke({"query": "doors"})

    assert "fire.pdf, page 3" in compared and "budget.xlsx" in compared
    assert "[fire.pdf, page 3]" in answered
    assert {c["folderId"] for c in calls} == {"D1"}
    assert calls[0]["topK"] == 30

    # The consistency-specialist's tools come from the same platform endpoint.
    api_tools = {tool.name for tool in runtime._build_dalux_api_tools()}
    assert {"check_document_consistency", "search_task_index", "search_docs"} <= api_tools


def test_live_platform_search():
    """Optional: against a running platform (DALUX_PLATFORM_LIVE_TEST=1 plus the usual env)."""
    import os

    if not os.environ.get("DALUX_PLATFORM_LIVE_TEST"):
        pytest.skip("set DALUX_PLATFORM_LIVE_TEST=1 and DALUX_PLATFORM_* to run")
    config = PlatformConfig.from_env()
    assert config is not None
    documents = PlatformRetriever(platform=config, tool="search_docs").invoke("brand")
    assert all(isinstance(d, Document) for d in documents)
