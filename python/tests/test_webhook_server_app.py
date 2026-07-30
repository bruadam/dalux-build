"""Tests for dalux_build.webhook_server.app.build_app.

Requires the 'webhook' extra (fastapi/httpx) to run.
"""
import hashlib
import hmac
import json

from fastapi.testclient import TestClient

from dalux_build.webhook_server.app import build_app
from dalux_build.webhook_server.config import QaConfig
from dalux_build.webhook_server.service import CheckResult
from dalux_build.webhook_server.store import Store
from dalux_build.webhook_server.watchlist import WatchedFile, WatchList


class FakeService:
    def __init__(self, check_result=None):
        self._check_result = check_result

    def check(self, project_id, file_area_id, file_id, download=True):
        return self._check_result

    def get_metadata(self, project_id, file_area_id, file_id):
        return {}

    def ensure_local_copy(self, project_id, file_area_id, file_id):
        return CheckResult(file_id, False, {})


def _sign(body: bytes) -> str:
    return hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()


def _build(tmp_path, watched=None, service=None, qa_trigger=None):
    watchlist = WatchList(watched or [])
    store = Store(str(tmp_path / "state.sqlite3"))
    app = build_app(
        watchlist=watchlist,
        store=store,
        service=service or FakeService(),
        webhook_secret="s3cret",
        signature_header="X-Dalux-Signature",
        qa_config=QaConfig(),
        qa_trigger=qa_trigger,
    )
    return app, watchlist, store


def test_webhook_flow(tmp_path):
    check_result = CheckResult(
        "f1",
        True,
        {"fileRevisionId": "r1", "fileName": "model.ifc", "contentHash": "abc"},
        downloaded_path=str(tmp_path / "model.ifc"),
        reason="changed",
    )
    triggered = []
    app, _, _ = _build(
        tmp_path,
        watched=[WatchedFile("p1", "fa1", "f1")],
        service=FakeService(check_result),
        qa_trigger=lambda cfg, event: triggered.append(event),
    )

    client = TestClient(app)
    body = json.dumps(
        {"eventId": "e1", "fileId": "f1", "projectId": "p1", "fileAreaId": "fa1"}
    ).encode()
    headers = {"X-Dalux-Signature": _sign(body), "Content-Type": "application/json"}

    resp = client.post("/webhooks/dalux", content=body, headers=headers)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["processed"][0]["changed"] is True
    assert len(triggered) == 1
    assert triggered[0]["fileId"] == "f1"


def test_webhook_rejects_bad_signature(tmp_path):
    app, _, _ = _build(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/webhooks/dalux",
        content=b"{}",
        headers={"X-Dalux-Signature": "wrong", "Content-Type": "application/json"},
    )
    assert resp.status_code == 401


def test_webhook_ignores_unwatched_and_dedupes(tmp_path):
    app, _, _ = _build(tmp_path, qa_trigger=lambda cfg, event: None)
    client = TestClient(app)
    body = json.dumps({"eventId": "dup1", "fileId": "not-watched"}).encode()
    headers = {"X-Dalux-Signature": _sign(body), "Content-Type": "application/json"}

    first = client.post("/webhooks/dalux", content=body, headers=headers)
    assert first.status_code == 200
    assert first.json()["processed"] == []

    second = client.post("/webhooks/dalux", content=body, headers=headers)
    assert second.json()["status"] == "duplicate"


def test_healthz(tmp_path):
    app, _, _ = _build(tmp_path, watched=[WatchedFile("p", "fa", "f")])
    client = TestClient(app)
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "watched_files": 1}
