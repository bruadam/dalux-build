"""Exercise adaptive retrieval branches without paid model calls."""

from types import SimpleNamespace

import pytest

pytest.importorskip("langgraph")
from langchain_core.documents import Document
from langchain_core.messages import AIMessage

from dalux_build.ai.rag.adaptive import AnswerGrade, Grade, Route, build_adaptive_rag


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
