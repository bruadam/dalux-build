import hashlib
import hmac
import json

from fastapi.testclient import TestClient

from dalux_webhook import qa
from dalux_webhook.app import create_app
from dalux_webhook.config import Settings
from dalux_webhook.dalux import CheckResult


def _settings(tmp_path, watch_file):
    return Settings(
        dalux_base_url="https://example.dalux.com/api",
        dalux_api_key="k",
        webhook_secret="s3cret",
        webhook_signature_header="X-Dalux-Signature",
        watchlist_path=str(watch_file),
        state_db_path=str(tmp_path / "state.sqlite3"),
        download_dir=str(tmp_path / "downloads"),
        qa_webhook_url="",
        qa_webhook_token="",
        qa_command="",
        host="127.0.0.1",
        port=8000,
    )


def _sign(body: bytes) -> str:
    return hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()


def test_webhook_flow(tmp_path, monkeypatch):
    watch = tmp_path / "watchlist.json"
    watch.write_text(
        json.dumps({"watch": [{"project_id": "p1", "file_area_id": "fa1", "file_id": "f1"}]})
    )
    app = create_app(_settings(tmp_path, watch))
    ctx = app.state.ctx

    def fake_check(project_id, file_area_id, file_id, download=True):
        return CheckResult(
            file_id,
            True,
            {"fileRevisionId": "r1", "fileName": "model.ifc", "contentHash": "abc"},
            downloaded_path=str(tmp_path / "model.ifc"),
            reason="changed",
        )

    monkeypatch.setattr(ctx.dalux, "check", fake_check)
    triggered = []
    monkeypatch.setattr(qa, "trigger", lambda settings, event: triggered.append(event))

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
    watch = tmp_path / "watchlist.json"
    watch.write_text(json.dumps({"watch": []}))
    app = create_app(_settings(tmp_path, watch))
    client = TestClient(app)
    resp = client.post(
        "/webhooks/dalux",
        content=b"{}",
        headers={"X-Dalux-Signature": "wrong", "Content-Type": "application/json"},
    )
    assert resp.status_code == 401


def test_webhook_ignores_unwatched_and_dedupes(tmp_path, monkeypatch):
    watch = tmp_path / "watchlist.json"
    watch.write_text(json.dumps({"watch": []}))
    app = create_app(_settings(tmp_path, watch))
    monkeypatch.setattr(qa, "trigger", lambda settings, event: None)

    client = TestClient(app)
    body = json.dumps({"eventId": "dup1", "fileId": "not-watched"}).encode()
    headers = {"X-Dalux-Signature": _sign(body), "Content-Type": "application/json"}

    first = client.post("/webhooks/dalux", content=body, headers=headers)
    assert first.status_code == 200
    assert first.json()["processed"] == []

    second = client.post("/webhooks/dalux", content=body, headers=headers)
    assert second.json()["status"] == "duplicate"


def test_healthz(tmp_path):
    watch = tmp_path / "watchlist.json"
    watch.write_text(json.dumps({"watch": [{"project_id": "p", "file_area_id": "fa", "file_id": "f"}]}))
    app = create_app(_settings(tmp_path, watch))
    client = TestClient(app)
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "watched_files": 1}
