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

import os
from typing import Protocol

from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model
from langchain_core.tools import tool

from ..rag.vectorstore import open_vectorstore
from ..reference import BYGGERIETSREGLER_CORPUS
from ..reference.store import open_reference_store, reference_store_exists
from .skills_loader import SKILLS_DIR, find_skill
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


# Maps a provider name to (langchain init_chat_model provider prefix, default model).
_PROVIDER_MODELS = {
    "openrouter": ("openrouter", "z-ai/glm-5.2:free"),
    "mistral": ("mistralai", "mistral-large-latest"),
}
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
    # (not instead of) being discoverable via SkillsMiddleware below.
    return f"{_DEFAULT_SYSTEM_PROMPT}\n\n{skill.body}"


def _build_retriever_tool() -> object:
    cache_key = _env("DALUX_AGENT_CACHE_KEY")
    embeddings_provider = os.environ.get("DALUX_AGENT_EMBEDDINGS_PROVIDER", "local")
    verbose = bool(os.environ.get("DALUX_AGENT_VERBOSE"))
    store = open_vectorstore(cache_key, embeddings_provider, verbose=verbose)
    retriever = store.as_retriever(search_kwargs={"k": 6})

    @tool
    def search_dalux_documents(query: str) -> str:
        """Search the indexed Dalux PDF documents for content relevant to the query."""
        docs = retriever.invoke(query)
        if not docs:
            return "No relevant excerpts found in the indexed documents."
        parts = []
        for doc in docs:
            source = doc.metadata.get("file_name", "unknown")
            page = doc.metadata.get("page")
            header = f"[{source}" + (f", page {page}]" if page is not None else "]")
            parts.append(f"{header}\n{doc.page_content}")
        return "\n\n---\n\n".join(parts)

    return search_dalux_documents


def _build_reference_tools() -> list[object]:
    """Retriever tools for every standing reference corpus that's been indexed.

    Corpora that haven't been crawled/indexed yet (see
    ``dalux_build.ai.reference``) are silently skipped — the agent still
    works fine without them.
    """
    embeddings_provider = os.environ.get("DALUX_AGENT_EMBEDDINGS_PROVIDER", "local")
    tools: list[object] = []

    for corpus_name, tool_name, description in _REFERENCE_CORPORA:
        if not reference_store_exists(corpus_name):
            continue
        store = open_reference_store(corpus_name, embeddings_provider)
        retriever = store.as_retriever(search_kwargs={"k": 6})

        def _make_tool(tool_name: str, description: str, retriever: _Retriever) -> object:
            def _search(query: str) -> str:
                docs = retriever.invoke(query)
                if not docs:
                    return "No relevant excerpts found in this reference corpus."
                parts = []
                for doc in docs:
                    source = doc.metadata.get("source", "unknown")
                    parts.append(f"[{source}]\n{doc.page_content}")
                return "\n\n---\n\n".join(parts)

            return tool(tool_name, description=description)(_search)

        tools.append(_make_tool(tool_name, description, retriever))

    return tools


def _build_web_search_tools() -> list[object]:
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


def _build_chat_model() -> object:
    provider = os.environ.get("DALUX_AGENT_PROVIDER", "openrouter")
    if provider not in _PROVIDER_MODELS:
        raise RuntimeError(
            f"Unsupported provider {provider!r}; supported: {', '.join(_PROVIDER_MODELS)}"
        )
    prefix, default_model = _PROVIDER_MODELS[provider]
    model = os.environ.get("DALUX_AGENT_MODEL") or default_model
    # One tool call per turn: the deep-agents-ui UI reads more naturally as a
    # sequence, and it avoids surprises from several search_dalux_documents
    # calls racing on the same underlying store.
    return init_chat_model(f"{prefix}:{model}", model_kwargs={"parallel_tool_calls": False})


_verbose = bool(os.environ.get("DALUX_AGENT_VERBOSE"))
if _verbose:
    print("Building deep agent graph...")

graph = create_deep_agent(
    model=_build_chat_model(),
    tools=[_build_retriever_tool(), *_build_reference_tools(), *_build_web_search_tools()],
    system_prompt=_build_system_prompt(os.environ.get("DALUX_AGENT_SKILL")),
    skills=[str(SKILLS_DIR)],
    subagents=build_specialist_subagents(),
)

if _verbose:
    print("Deep agent graph ready.")
