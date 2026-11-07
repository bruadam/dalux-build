"""Specialist subagents for the Dalux deep agent.

Each subagent runs as its own isolated reasoning loop — a fresh context
window, autonomous execution until completion, a single report handed back
to the orchestrator — via the LangChain `task()` tool. The orchestrator
picks which specialist to call based on each subagent's `description`; no
extra wiring is needed for that beyond registering them here.
"""

from __future__ import annotations

from typing import TypedDict


class SubAgent(TypedDict):
    """Specialist configuration; all specialists share the Mistral model and tools."""

    name: str
    description: str
    system_prompt: str
    recursion_limit: int


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


_CONSISTENCY_SYSTEM_PROMPT = (
    "You review construction project documents for inconsistencies between "
    "documents (uoverensstemmelser/modstrid): conflicting values, quantities, "
    "dates, references, and revisions.\n\n"
    "1. Call get_skill with topic 'document-consistency-review', then with topic "
    "'danish-construction-contracts', and follow both.\n"
    "2. Call check_document_consistency with the projectId and fileAreaId (plus "
    "folderPath, fileIds, or focus if the request names them). While the result "
    "has complete=false, call it again with exactly the same arguments.\n"
    "3. Page through list_inconsistencies with the reportId (offset/limit) until "
    "you have seen every finding.\n"
    "4. For each finding with verdict 'candidate', check it yourself: use "
    "compare_dalux_documents (and search_dalux_documents or search_file_content) "
    "to read the surrounding text in each cited file. Keep it only if the "
    "documents really say different things about the same subject; note which "
    "document takes precedence under the contract's priority order when the "
    "documents state one.\n"
    "5. Finish by calling export_inconsistency_report with the reportId (format "
    "'xlsx' unless the user asked for 'docx' or 'md').\n\n"
    "Report the confirmed findings grouped by severity. Cite every statement as "
    "[file, page/location] with a short verbatim quote. List the candidates you "
    "rejected and why, any skipped files and warnings, and the exported report's "
    "fileName and downloadUrl. If the consistency tools are not available, say so "
    "instead of inventing findings. Respond in the language of the request."
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
            "recursion_limit": 30,
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
            "recursion_limit": 30,
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
            "recursion_limit": 30,
        },
        {
            "name": "consistency-specialist",
            "description": (
                "Finds inconsistencies between documents (uoverensstemmelser, "
                "modstrid): conflicting values, quantities, dates, references or "
                "revisions across files. Runs the full consistency check, verifies "
                "candidate findings, and exports a report. Delegate here with the "
                "projectId, fileAreaId and any folder or files to cover."
            ),
            "system_prompt": _CONSISTENCY_SYSTEM_PROMPT,
            # Checking, paging and verifying findings takes many tool calls.
            "recursion_limit": 150,
        },
    ]
