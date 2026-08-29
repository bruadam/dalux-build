"""Tests for specialist subagent definitions (dalux_build.ai.agent.subagents)."""

from dalux_build.ai.agent.subagents import build_specialist_subagents


def test_build_specialist_subagents_returns_expected_names():
    subagents = build_specialist_subagents()

    names = [subagent["name"] for subagent in subagents]
    assert names == [
        "legal-specialist",
        "construction-pm-specialist",
        "entrepriseret-specialist",
    ]


def test_each_subagent_has_required_fields():
    for subagent in build_specialist_subagents():
        assert subagent["name"]
        assert subagent["description"]
        assert subagent["system_prompt"]
        # No `tools` override, so each inherits the orchestrator's tools
        # (including the retriever) by default.
        assert "tools" not in subagent


def test_subagent_names_are_unique():
    subagents = build_specialist_subagents()
    names = [subagent["name"] for subagent in subagents]
    assert len(names) == len(set(names))


def test_entrepriseret_subagent_covers_danish_standard_terms():
    subagents = {s["name"]: s for s in build_specialist_subagents()}
    prompt = subagents["entrepriseret-specialist"]["system_prompt"]

    for term in ("AB18", "ABT18", "ABR18"):
        assert term in prompt
