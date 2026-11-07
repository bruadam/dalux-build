"""Specialists and skills survive the agent framework migration."""

import asyncio
from types import SimpleNamespace

import pytest

pytest.importorskip("langchain")
pytest.importorskip("langchain_mistralai")
from dalux_build.ai.agent import graph_runtime as runtime


def test_specialists_share_model_and_tools_but_receive_fresh_messages(monkeypatch):
    calls = []
    configured = []

    class Agent:
        async def ainvoke(self, state, config):
            calls.append((state, config))
            return {"messages": [SimpleNamespace(text="specialist report")]}

    def create(**kwargs):
        configured.append(kwargs)
        return Agent()

    monkeypatch.setattr(runtime, "create_agent", create)
    model, tools = object(), []
    delegate = runtime._build_delegation_tool(model, tools)
    result = asyncio.run(
        delegate.ainvoke({"subagent_type": "legal-specialist", "description": "Review this clause"})
    )
    assert result == "specialist report"
    assert len(configured) == 3
    assert all(c["model"] is model and c["tools"] is tools for c in configured)
    assert calls[0][0] == {"messages": [{"role": "user", "content": "Review this clause"}]}
    assert calls[0][1]["recursion_limit"] == 30


def test_skill_tool_exposes_bundled_instructions():
    skill = runtime.load_skills()[0]
    assert runtime._build_skill_tool().invoke({"name": skill.name}) == skill.body
