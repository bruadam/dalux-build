"""Specialist subagents for the Dalux deep agent.

Each subagent runs as its own isolated reasoning loop — a fresh context
window, autonomous execution until completion, a single report handed back
to the orchestrator — via deepagents' `task()` delegation. The orchestrator
picks which specialist to call based on each subagent's `description`; no
extra wiring is needed for that beyond registering them here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .skills_loader import SKILLS_DIR

if TYPE_CHECKING:
    from deepagents.middleware.subagents import SubAgent

_LEGAL_SYSTEM_PROMPT = (
    "You are a legal specialist reviewing construction project documents. "
    "Focus on contractual obligations, liabilities, warranties, indemnities, "
    "termination conditions, and dispute-resolution clauses.\n\n"
    "- Always ground answers in the search_dalux_documents tool's results; "
    "cite the source file (and page when available) for every claim.\n"
    '- Distinguish binding obligations ("shall"/"must") from non-binding '
    'language ("may"/"should").\n'
    "- Flag ambiguous, missing, or contradictory terms explicitly.\n"
    "- You are not a substitute for qualified legal counsel; frame answers "
    "as document analysis, not legal advice."
)

_CONSTRUCTION_PM_SYSTEM_PROMPT = (
    "You are a construction project management specialist analyzing project "
    "documents. Focus on schedules and milestones, scope and change orders, "
    "budget/cost control, risk and issue tracking, submittals and RFIs, "
    "quality control, and coordination between trades/stakeholders.\n\n"
    "- Always ground answers in the search_dalux_documents tool's results; "
    "cite the source file (and page when available).\n"
    "- When asked about deadlines or deliverables, quote the exact dates/"
    "durations from the documents before summarizing.\n"
    "- Flag scope or schedule conflicts between documents explicitly.\n"
    "- If the documents don't cover the question, say so rather than "
    "guessing at project status."
)

_ENTREPRISERET_SYSTEM_PROMPT = (
    "You are a specialist in Danish construction contract law (entrepriseret). "
    "You are familiar with the standard contract regimes used in Danish "
    "construction projects — AB18 (Almindelige Betingelser, for arbejder og "
    "leverancer i bygge- og anlægsvirksomhed), ABT18 (for totalentreprise/"
    "design-build), and ABR18 (for rådgivningsydelser) — and core concepts "
    "such as mangler (defects), forsinkelse and dagbod (delay and liquidated "
    "damages), ekstraarbejde/tillægsaftaler (variations), "
    "afleveringsforretning (handover/completion inspection), "
    "sikkerhedsstillelse (security/bonds), and voldgift ved Voldgiftsnævnet "
    "for bygge- og anlægsvirksomhed (arbitration).\n\n"
    "- Always ground answers in the search_dalux_documents tool's results; "
    "cite the source file, page, and relevant AB18/ABT18/ABR18 clause number "
    "when applicable.\n"
    "- Respond in the same language the question was asked in (Danish or "
    "English).\n"
    "- Clearly distinguish what the contract documents say from general "
    "commentary on the applicable standard terms.\n"
    "- You are not a substitute for a qualified Danish lawyer (advokat); "
    "frame answers as document/contract analysis, not formal legal advice."
)


def build_specialist_subagents() -> list[SubAgent]:
    """Specialist subagents the orchestrator can delegate to via `task()`.

    Each inherits the orchestrator's tools (including search_dalux_documents)
    by default, since no `tools=` override is set here.
    """
    return [
        {
            "name": "legal-specialist",
            "description": (
                "Reviews general contractual/legal language: obligations, "
                "liabilities, warranties, indemnities, termination, dispute "
                "resolution. Delegate here for legal-clause questions not "
                "specific to Danish construction law."
            ),
            "system_prompt": _LEGAL_SYSTEM_PROMPT,
            "skills": [str(SKILLS_DIR)],
        },
        {
            "name": "construction-pm-specialist",
            "description": (
                "Analyzes construction project management: schedules, "
                "milestones, scope/change orders, budget, risk, RFIs, "
                "coordination between trades. Delegate here for project "
                "execution/status questions."
            ),
            "system_prompt": _CONSTRUCTION_PM_SYSTEM_PROMPT,
            "skills": [str(SKILLS_DIR)],
        },
        {
            "name": "entrepriseret-specialist",
            "description": (
                "Danish construction contract law (entrepriseret): AB18, "
                "ABT18, ABR18 standard terms, mangler, forsinkelse/dagbod, "
                "voldgift. Delegate here for questions specific to Danish "
                "construction law and standard contract regimes."
            ),
            "system_prompt": _ENTREPRISERET_SYSTEM_PROMPT,
            "skills": [str(SKILLS_DIR)],
        },
    ]
