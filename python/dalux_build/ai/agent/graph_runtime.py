"""LangGraph entrypoint for the Dalux RAG deep agent.

This module is imported by ``langgraph dev`` in its own subprocess (see
``engine.py``, which writes a ``langgraph.json`` pointing a graph name at
this file). All configuration therefore comes from environment variables
set on that subprocess rather than function arguments — there is no other
channel between the parent process and the imported module.

By this point ingestion (download + chunk + embed) has already happened in
the parent process (``engine.launch_agent`` -> ``rag.ingest``/``rag.vectorstore``);
this module only opens the already-persisted Chroma collection.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Callable
from typing import Protocol

from langchain.agents import create_agent
from langchain_core.documents import Document
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool, tool
from langchain_mistralai import ChatMistralAI

from ..rag.adaptive import build_adaptive_rag
from ..rag.vectorstore import open_vectorstore
from ..reference import BYGGERIETSREGLER_CORPUS
from ..reference.store import open_reference_store, reference_store_exists
from .mcp_server import MCP_SERVER_NAME, resolve_mcp_server_entrypoint, stdio_connection
from .skills_loader import find_skill, load_skills
from .subagents import build_specialist_subagents

# Standing reference corpora (see dalux_build.ai.reference): (corpus name,
# tool name, tool description). Each is merged in automatically once
# indexed — no per-Dalux-scope wiring needed, unlike search_dalux_documents.
_REFERENCE_CORPORA = [
    (
        BYGGERIETSREGLER_CORPUS,
        "search_byggerietsregler",
        "Search Danish building regulations (byggerietsregler.dk) for content "
        "relevant to the query.",
    ),
]


class _RetrievedDocument(Protocol):
    """The subset of langchain_core.documents.Document used here."""

    metadata: dict[str, object]
    page_content: str


class _Retriever(Protocol):
    """The subset of a vector store retriever's interface used here."""

    def invoke(self, query: str) -> list[_RetrievedDocument]: ...


_DEFAULT_SYSTEM_PROMPT = (
    "You are a document Q&A assistant for construction project files retrieved "
    "from Dalux. Always ground your answers in the search_dalux_documents tool's "
    "results, cite the source file (and page when available), and say so plainly "
    "when the indexed documents don't contain the answer.\n\n"
    "For questions that call for deeper domain expertise, delegate to the "
    "relevant specialist via the task tool: legal-specialist (general "
    "contractual/legal language), construction-pm-specialist (schedules, "
    "scope, budget, risk), or entrepriseret-specialist (Danish construction "
    "contract law — AB18/ABT18/ABR18). Synthesize their reports into your "
    "final answer to the user.\n\n"
    "If a web_search tool is available and a question needs a specific law, "
    "regulation, or publicly available document not covered by the indexed "
    "documents or reference corpora, use it — but still prefer indexed "
    "sources when they answer the question."
)


def _env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set in the environment for the agent graph to load")
    return value


def _build_system_prompt(skill_name: str | None) -> str:
    if not skill_name:
        return _DEFAULT_SYSTEM_PROMPT
    skill = find_skill(skill_name)
    if skill is None:
        raise RuntimeError(f"Unknown skill {skill_name!r}; check `skills.sh` for available names")
    # The explicitly requested skill's instructions are folded directly into
    # the system prompt so it governs behavior immediately, in addition to
    # (not instead of) being discoverable via the read_skill tool below.
    return f"{_DEFAULT_SYSTEM_PROMPT}\n\n{skill.body}"


def _adaptive_answer(retriever: _Retriever) -> Callable[[str], str]:
    def retrieve(query: str) -> list[Document]:
        return [
            Document(page_content=doc.page_content, metadata=doc.metadata)
            for doc in retriever.invoke(query)
        ]

    def web_search(query: str) -> list[Document]:
        from ..reference.firecrawl_client import web_search as search

        return [
            Document(
                page_content=result.markdown or result.description or "",
                metadata={"source": result.url},
            )
            for result in search(query, limit=5, scrape_content=True)
        ]

    return build_adaptive_rag(
        _build_chat_model(),
        retrieve,
        web_search if os.environ.get("FIRECRAWL_API_KEY") else None,
    )


def _build_retriever_tool() -> BaseTool:
    cache_key = _env("DALUX_AGENT_CACHE_KEY")
    embeddings_provider = os.environ.get("DALUX_AGENT_EMBEDDINGS_PROVIDER", "mistral")
    verbose = bool(os.environ.get("DALUX_AGENT_VERBOSE"))
    store = open_vectorstore(cache_key, embeddings_provider, verbose=verbose)
    answer = _adaptive_answer(store.as_retriever(search_kwargs={"k": 6}))

    @tool
    def search_dalux_documents(query: str) -> str:
        """Answer a question about Dalux PDFs with relevance and grounding checks and citations."""
        return answer(query)

    return search_dalux_documents


def _build_reference_tools() -> list[BaseTool]:
    """Retriever tools for every standing reference corpus that's been indexed.

    Corpora that haven't been crawled/indexed yet (see
    ``dalux_build.ai.reference``) are silently skipped — the agent still
    works fine without them.
    """
    embeddings_provider = os.environ.get("DALUX_AGENT_EMBEDDINGS_PROVIDER", "mistral")
    tools: list[BaseTool] = []

    for corpus_name, tool_name, description in _REFERENCE_CORPORA:
        if not reference_store_exists(corpus_name):
            continue
        store = open_reference_store(corpus_name, embeddings_provider)
        retriever = store.as_retriever(search_kwargs={"k": 6})

        def _make_tool(tool_name: str, description: str, retriever: _Retriever) -> BaseTool:
            return tool(tool_name, description=description)(_adaptive_answer(retriever))

        tools.append(_make_tool(tool_name, description, retriever))

    return tools


def _build_web_search_tools() -> list[BaseTool]:
    """A live Firecrawl web-search tool, only added when FIRECRAWL_API_KEY is set.

    Unlike the reference-corpus retriever tools above (searching a static,
    pre-indexed store), this hits the web in real time — for specific laws,
    regulations, or publicly available documents that haven't been crawled
    into a standing corpus. Skipped silently without a key, same as the
    reference corpora being skipped when not yet indexed.
    """
    if not os.environ.get("FIRECRAWL_API_KEY"):
        return []

    def _search(query: str) -> str:
        from ..reference.firecrawl_client import web_search

        results = web_search(query, limit=5, scrape_content=True)
        if not results:
            return "No web search results found."
        parts = []
        for result in results:
            header = f"[{result.title or result.url}]({result.url})"
            if result.description:
                header += f"\n{result.description}"
            parts.append(f"{header}\n\n{result.markdown or ''}".strip())
        return "\n\n---\n\n".join(parts)

    web_search_tool = tool(
        "web_search",
        description=(
            "Search the web for specific laws, regulations, or publicly "
            "available documents not already covered by the indexed Dalux "
            "documents or reference corpora. Returns page content, not just "
            "links — use for up-to-date or external information."
        ),
    )(_search)

    return [web_search_tool]


def _build_dalux_api_tools() -> list[BaseTool]:
    """Read-only Dalux API tools (files/folders/tasks/projects/...), loaded
    from the TypeScript MCP server (see mcp-server/) over stdio.

    Complements search_dalux_documents (unstructured retrieval over indexed
    PDFs) with structured access to live project data. MCP's stdio transport
    is plain JSON-RPC over stdin/stdout, so this works regardless of the
    server being written in a different language than the agent.
    """
    entrypoint = resolve_mcp_server_entrypoint()
    if entrypoint is None:
        return []

    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient

        client = MultiServerMCPClient(
            {MCP_SERVER_NAME: stdio_connection(entrypoint, dict(os.environ))}
        )
        return asyncio.run(client.get_tools())
    except Exception as exc:  # noqa: BLE001 - optional tool group, must not crash the agent
        if bool(os.environ.get("DALUX_AGENT_VERBOSE")):
            print(f"Skipping Dalux API MCP tools: {exc}")
        return []


def _build_chat_model() -> BaseChatModel:
    provider = os.environ.get("DALUX_AGENT_PROVIDER", "mistral")
    if provider != "mistral":
        raise RuntimeError(f"Unsupported provider {provider!r}; supported: mistral")
    return ChatMistralAI(
        model=os.environ.get("DALUX_AGENT_MODEL") or "mistral-large-latest",
        temperature=0,
    )


def _build_skill_tool() -> BaseTool:
    catalog = "\n".join(f"- {skill.name}: {skill.description}" for skill in load_skills())

    @tool(description=f"Read instructions for a specialist skill. Available skills:\n{catalog}")
    def read_skill(name: str) -> str:
        skill = find_skill(name)
        if skill is None:
            return f"Unknown skill {name!r}. Available skills:\n{catalog}"
        return skill.body

    return read_skill


def _build_delegation_tool(model: BaseChatModel, tools: list[BaseTool]) -> BaseTool:
    specialists = {
        spec["name"]: create_agent(model=model, tools=tools, system_prompt=spec["system_prompt"])
        for spec in build_specialist_subagents()
    }
    descriptions = "\n".join(
        f"- {spec['name']}: {spec['description']}" for spec in build_specialist_subagents()
    )

    @tool(description=f"Delegate a question to a specialist in a fresh context.\n{descriptions}")
    async def task(subagent_type: str, description: str) -> str:
        specialist = specialists.get(subagent_type)
        if specialist is None:
            return f"Unknown specialist {subagent_type!r}. Choose from {', '.join(specialists)}."
        result = await specialist.ainvoke(
            {"messages": [{"role": "user", "content": description}]},
            config={"recursion_limit": 30},
        )
        return str(result["messages"][-1].text)

    return task


def build_graph() -> object:
    """Build a Mistral LangChain agent and isolated specialist agents."""
    model = _build_chat_model()
    tools = [
        _build_retriever_tool(),
        *_build_reference_tools(),
        *_build_web_search_tools(),
        *_build_dalux_api_tools(),
        _build_skill_tool(),
    ]
    return create_agent(
        model=model,
        tools=[*tools, _build_delegation_tool(model, tools)],
        system_prompt=_build_system_prompt(os.environ.get("DALUX_AGENT_SKILL")),
    )
