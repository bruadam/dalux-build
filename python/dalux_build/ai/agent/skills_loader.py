"""Minimal reader for SKILL.md files (the Agent Skills standard).

This is independent of deepagents' own ``SkillsMiddleware`` parser, which
loads skills at agent runtime for automatic, description-based activation.
This module exists for two things the middleware doesn't do: human-facing
search (see ``dalux_build.ai.skills_cli``) and forcing a specific skill's
instructions into the system prompt when a caller passes ``skill=<name>``
explicitly to ``.agent(...)``, rather than leaving selection entirely to the
model.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

SKILLS_DIR = Path(__file__).parent / "skills"


@dataclass(frozen=True)
class Skill:
    """A parsed SKILL.md file: frontmatter metadata plus instruction body."""

    name: str
    description: str
    tags: tuple[str, ...]
    body: str
    path: Path


def _parse_skill_md(path: Path) -> Skill:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise ValueError(f"{path} is missing YAML frontmatter")

    _, frontmatter_raw, body = text.split("---", 2)
    frontmatter = yaml.safe_load(frontmatter_raw) or {}

    name = frontmatter.get("name")
    description = frontmatter.get("description")
    if not name or not description:
        raise ValueError(f"{path} frontmatter must include 'name' and 'description'")

    metadata = frontmatter.get("metadata") or {}
    tags = tuple(metadata.get("tags", []))

    return Skill(name=name, description=description, tags=tags, body=body.strip(), path=path)


def load_skills(directory: Path | None = None) -> list[Skill]:
    """Load every skill under *directory* (defaults to the bundled skills/ dir).

    Each skill lives at ``<directory>/<skill-name>/SKILL.md``, per the Agent
    Skills standard: https://docs.langchain.com/oss/python/deepagents/skills
    """
    root = directory or SKILLS_DIR
    return [_parse_skill_md(skill_md) for skill_md in sorted(root.glob("*/SKILL.md"))]


def find_skill(name: str, directory: Path | None = None) -> Skill | None:
    """Look up a single skill by its exact frontmatter ``name``."""
    for skill in load_skills(directory):
        if skill.name == name:
            return skill
    return None
