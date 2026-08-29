"""Tests for the SKILL.md loader and skills.sh search CLI."""

import pytest

from dalux_build.ai import skills_cli
from dalux_build.ai.agent import skills_loader


def _write_skill(tmp_path, name, description, tags=None, body="Do the thing."):
    skill_dir = tmp_path / name
    skill_dir.mkdir()
    frontmatter_tags = f"\nmetadata:\n  tags: [{', '.join(tags)}]" if tags else ""
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}{frontmatter_tags}\n---\n\n{body}\n",
        encoding="utf-8",
    )
    return skill_dir


def test_load_skills_parses_frontmatter_and_body(tmp_path):
    _write_skill(tmp_path, "arxiv-search", "Search arXiv for papers.", tags=["research", "papers"])

    skills = skills_loader.load_skills(tmp_path)

    assert len(skills) == 1
    skill = skills[0]
    assert skill.name == "arxiv-search"
    assert skill.description == "Search arXiv for papers."
    assert skill.tags == ("research", "papers")
    assert skill.body == "Do the thing."


def test_load_skills_missing_required_fields_raises(tmp_path):
    skill_dir = tmp_path / "broken-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("---\nname: broken-skill\n---\n\nBody.\n", encoding="utf-8")

    with pytest.raises(ValueError, match="name.*description"):
        skills_loader.load_skills(tmp_path)


def test_find_skill_exact_name_match(tmp_path):
    _write_skill(tmp_path, "legal-contract-review", "Reads contracts.")
    _write_skill(tmp_path, "general-document-qa", "Answers general questions.")

    found = skills_loader.find_skill("legal-contract-review", tmp_path)

    assert found is not None
    assert found.description == "Reads contracts."
    assert skills_loader.find_skill("does-not-exist", tmp_path) is None


def test_bundled_skills_are_valid():
    skills = skills_loader.load_skills()
    names = {skill.name for skill in skills}

    assert "legal-contract-review" in names
    assert "general-document-qa" in names
    assert "entrepriseret" in names
    assert "construction-project-management" in names


def test_search_skills_matches_name_description_and_tags(tmp_path):
    _write_skill(tmp_path, "legal-contract-review", "Reads contracts.", tags=["legal", "contract"])
    _write_skill(tmp_path, "general-document-qa", "Answers general questions.", tags=["general"])
    pool = skills_loader.load_skills(tmp_path)

    assert {s.name for s in skills_cli.search_skills("legal", pool)} == {"legal-contract-review"}
    assert {s.name for s in skills_cli.search_skills("contract", pool)} == {"legal-contract-review"}
    assert {s.name for s in skills_cli.search_skills("general", pool)} == {"general-document-qa"}
    assert {s.name for s in skills_cli.search_skills("", pool)} == {
        "legal-contract-review",
        "general-document-qa",
    }
    assert skills_cli.search_skills("nonexistent", pool) == []


def test_main_returns_nonzero_when_no_match(monkeypatch, capsys):
    monkeypatch.setattr(skills_cli, "load_skills", lambda: [])

    exit_code = skills_cli.main(["nonexistent-skill"])

    assert exit_code == 1
    assert "No skills matched" in capsys.readouterr().out
