"""Exercise adaptive retrieval branches without paid model calls."""

from types import SimpleNamespace

import pytest

pytest.importorskip("langgraph")
from langchain_core.documents import Document
from langchain_core.messages import AIMessage

from dalux_build.ai.rag.adaptive import (
    AnswerGrade,
    Grade,
    Route,
    build_adaptive_rag,
    citation_label,
    spread_across_files,
)


class Model:
    def __init__(self, *, relevant=True, grounded=True, route="vectorstore"):
        self.relevant = relevant
        self.grounded = grounded
        self.route = route
        self.generated = 0

    def with_structured_output(self, schema):
        def invoke(messages):
            if schema is Route:
                return Route(datasource=self.route)
            if schema is Grade:
                return Grade(yes=self.relevant)
            return AnswerGrade(grounded=self.grounded, useful=True)

        return SimpleNamespace(invoke=invoke)

    def invoke(self, messages):
        self.generated += 1
        return AIMessage(content="Doors have a fire rating [fire.pdf, page 1].")


def test_cited_answer_and_no_web_key():
    queries = []

    def retrieve(query):
        queries.append(query)
        return [
            Document(
                page_content="Fire-rated doors.", metadata={"file_name": "fire.pdf", "page": 1}
            )
        ]

    result = build_adaptive_rag(Model(), retrieve)("What rating?")
    assert "[fire.pdf, page 1]" in result
    assert queries == ["What rating?"]


@pytest.mark.parametrize("relevant,grounded", [(False, True), (True, False)])
def test_unverified_answers_stop_after_two_attempts(relevant, grounded):
    queries = []

    def retrieve(query):
        queries.append(query)
        return [Document(page_content="evidence")]

    answer = build_adaptive_rag(Model(relevant=relevant, grounded=grounded), retrieve)("question")
    assert "could not find enough" in answer
    assert len(queries) == 2


def test_web_route_when_configured():
    queries = []

    def web(query):
        queries.append(query)
        return [
            Document(page_content="Fire-rated doors.", metadata={"source": "https://example.test"})
        ]

    def retrieve(query):
        raise AssertionError("Web-routed question should not use the vector store")

    assert build_adaptive_rag(Model(route="websearch"), retrieve, web)("current question")
    assert queries == ["current question"]


def test_citation_label_uses_printed_page_number():
    assert citation_label({"file_name": "a.pdf", "page": 0, "page_label": "iv"}) == "a.pdf, page iv"
    assert citation_label({"file_name": "a.pdf", "page": 0}) == "a.pdf, page 1"
    assert citation_label({"source": "https://example.test"}) == "https://example.test"


def test_spread_across_files_caps_passages_per_file():
    ranked = [
        Document(page_content=f"{file_id}{n}", metadata={"file_id": file_id})
        for file_id, n in [("a", 1), ("a", 2), ("a", 3), ("b", 1), ("c", 1), ("b", 2)]
    ]

    kept = spread_across_files(ranked, limit=4, per_file=2)

    assert [doc.page_content for doc in kept] == ["a1", "a2", "b1", "c1"]
