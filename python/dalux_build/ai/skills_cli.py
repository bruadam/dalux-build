"""Search the bundled skills library.

Usage:
    python -m dalux_build.ai.skills_cli <query>
    dalux-skills <query>          # once the package is installed
    ./python/scripts/skills.sh <query>
"""

from __future__ import annotations

import sys

from .agent.skills_loader import Skill, load_skills


def search_skills(query: str, skills: list[Skill] | None = None) -> list[Skill]:
    """Case-insensitive substring match over a skill's name, description, and tags."""
    pool = skills if skills is not None else load_skills()
    needle = query.lower().strip()
    if not needle:
        return pool

    def matches(skill: Skill) -> bool:
        haystacks = [skill.name, skill.description, *skill.tags]
        return any(needle in haystack.lower() for haystack in haystacks)

    return [skill for skill in pool if matches(skill)]


def main(argv: list[str] | None = None) -> int:
    """Entry point for the `dalux-skills` console script / `skills.sh` wrapper."""
    args = sys.argv[1:] if argv is None else argv
    query = " ".join(args)
    results = search_skills(query)
    if not results:
        print(f"No skills matched {query!r}.")
        return 1
    for skill in results:
        tags = f" [{', '.join(skill.tags)}]" if skill.tags else ""
        print(f"{skill.name}{tags}\n  {skill.description}\n  {skill.path}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
