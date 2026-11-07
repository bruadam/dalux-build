"""Tests for the scripted consistency check (dalux_build.ai.agent.consistency)."""

import asyncio
from pathlib import Path

import pytest

from dalux_build.ai.agent import consistency
from dalux_build.ai.agent.errors import ConsistencyCheckError
from dalux_build.ai.namespace import AINamespace


def _finding(finding_id):
    return {
        "id": finding_id,
        "type": "date_conflict",
        "severity": "high",
        "subject": "Aflevering",
        "attribute": "dato",
        "summary": "Handover dates differ",
        "verdict": "confirmed",
        "statements": [
            {"fileId": "a", "fileName": "a.pdf", "location": "page 2", "quote": "1. maj"},
            {"fileId": "b", "fileName": "b.pdf", "location": "page 5", "quote": "1. juni"},
        ],
    }


class FakeServer:
    def __init__(self, rounds=2, findings=3, export=None):
        self.calls = []
        self.rounds = rounds
        self.findings = [_finding(str(i)) for i in range(findings)]
        self.export = export or {"filePath": "/tmp/report.xlsx", "format": "xlsx"}

    async def __call__(self, name, arguments):
        self.calls.append((name, arguments))
        if name == "check_document_consistency":
            checks = sum(call[0] == name for call in self.calls)
            return {"reportId": "r1", "complete": checks >= self.rounds, "findingsCount": 3}
        if name == "list_inconsistencies":
            start = arguments["offset"]
            page = self.findings[start : start + 2]
            return {"total": len(self.findings), "findings": page}
        return self.export


def test_runs_check_until_complete_and_pages_all_findings(monkeypatch):
    monkeypatch.setattr(consistency, "_PAGE_SIZE", 2)
    server = FakeServer(rounds=3, findings=3)

    report = asyncio.run(
        consistency.run_consistency_check(
            server, project_id="P", file_area_id="FA", folder_path="Files/Udbud", report_format="md"
        )
    )

    names = [name for name, _ in server.calls]
    assert names == ["check_document_consistency"] * 3 + ["list_inconsistencies"] * 2 + [
        "export_inconsistency_report"
    ]
    assert server.calls[0][1] == {"projectId": "P", "fileAreaId": "FA", "folderPath": "Files/Udbud"}
    assert [call[1]["offset"] for call in server.calls if call[0] == "list_inconsistencies"] == [
        0,
        2,
    ]
    assert server.calls[-1][1] == {"reportId": "r1", "format": "md"}
    assert [finding["id"] for finding in report.findings] == ["0", "1", "2"]
    assert report.report_id == "r1"
    assert report.report_path == Path("/tmp/report.xlsx")


def test_export_without_file_raises():
    server = FakeServer(rounds=1, findings=0, export={"message": "Report not found"})

    with pytest.raises(ConsistencyCheckError, match="Report not found"):
        asyncio.run(consistency.run_consistency_check(server, project_id="P", file_area_id="FA"))


def test_namespace_check_consistency_passes_client_and_arguments(monkeypatch):
    received = {}

    def fake_check(client, project_id, file_area_id, **kwargs):
        received.update(client=client, project_id=project_id, file_area_id=file_area_id, **kwargs)
        return "report"

    monkeypatch.setattr(consistency, "check_consistency", fake_check)
    client = object()

    result = AINamespace(client).check_consistency("P", "FA", focus=["dates"], max_files=10)

    assert result == "report"
    assert received["client"] is client
    assert (received["project_id"], received["file_area_id"]) == ("P", "FA")
    assert received["focus"] == ["dates"] and received["max_files"] == 10


def test_missing_mcp_server_build_raises(monkeypatch):
    monkeypatch.setattr(consistency, "resolve_mcp_server_entrypoint", lambda: None)
    client = type("C", (), {"configuration": type("Cfg", (), {"base_url": "u", "api_key": "k"})})()

    with pytest.raises(ConsistencyCheckError, match="not built"):
        consistency.check_consistency(client, "P", "FA")


def test_tool_errors_are_unwrapped_from_task_groups():
    error = ConsistencyCheckError("check_document_consistency failed: bad focus")
    group = type("Group", (Exception,), {})
    inner, outer = group(), group()
    inner.exceptions, outer.exceptions = (error,), (inner,)
    wrapped = outer

    assert consistency._find_consistency_error(wrapped) is error
    assert consistency._find_consistency_error(RuntimeError("other")) is None
