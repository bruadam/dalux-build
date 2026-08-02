import hashlib
import hmac
import json
from datetime import datetime, timezone

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from dalux_build.api_client import ApiClient
from dalux_build.configuration import Configuration
from dalux_build.models import FileNameFilter
from dalux_build.webhook_server.api import WebhookServerApi
from dalux_build.webhook_server.app import build_app
from dalux_build.webhook_server.controller import Jobs
from dalux_build.webhook_server.crypto import SecretBox
from dalux_build.webhook_server.delivery import DeliveryWorker
from dalux_build.webhook_server.models import (
    CallbackConfig,
    ChangeJobRequest,
    FileScope,
    FreshnessJobRequest,
)
from dalux_build.webhook_server.monitor import Monitor, fetch_pages
from dalux_build.webhook_server.scheduler import Scheduler
from dalux_build.webhook_server.store import Store, utcnow


def core(tmp_path):
    store = Store(str(tmp_path / "state.sqlite3"))
    box = SecretBox(Fernet.generate_key().decode())
    jobs = Jobs(store, box, "https://default.example/api", "UTC")
    monitor = Monitor(store, box)
    scheduler = Scheduler(store, monitor, DeliveryWorker(store, box))
    return store, box, jobs, monitor, scheduler


def change_request(initial_run="baseline"):
    return ChangeJobRequest(
        projectId="p1",
        fileAreaId="fa1",
        daluxApiKey="dalux-secret",
        cron="*/5 * * * *",
        callback=CallbackConfig(url="https://n8n.example/hook", authType="none"),
        scope=FileScope(mode="all"),
        initialRun=initial_run,
    )


def test_management_auth_idempotency_encryption_and_delete(tmp_path):
    store, _box, jobs, _monitor, scheduler = core(tmp_path)
    app = build_app(jobs=jobs, store=store, scheduler=scheduler, management_token="admin")
    with TestClient(app) as client:
        openapi = client.get("/openapi.json").json()
        security_scheme = openapi["components"]["securitySchemes"]["MONITOR_API_TOKEN"]
        assert security_scheme["type"] == "http"
        assert security_scheme["scheme"] == "bearer"
        assert "Bearer prefix" in security_scheme["description"]
        assert openapi["paths"]["/jobs/change"]["post"]["security"] == [{"MONITOR_API_TOKEN": []}]
        assert all(
            parameter["name"].lower() != "authorization"
            for parameter in openapi["paths"]["/jobs/change"]["post"]["parameters"]
        )
        body = change_request().model_dump(by_alias=True, mode="json")
        assert client.post("/jobs/change", json=body).status_code == 401
        headers = {"Authorization": "Bearer admin", "Idempotency-Key": "same"}
        first = client.post("/jobs/change", json=body, headers=headers)
        second = client.post("/jobs/change", json=body, headers=headers)
        assert first.status_code == 201
        assert second.status_code == 200
        assert first.json()["jobId"] == second.json()["jobId"]
        assert "daluxApiKey" not in first.text
        row = store.get_job(first.json()["jobId"])
        assert row["api_key_encrypted"] != "dalux-secret"
        assert client.delete(f"/jobs/{first.json()['jobId']}", headers=headers).status_code == 204
        assert client.delete(f"/jobs/{first.json()['jobId']}", headers=headers).status_code == 204


def test_job_test_endpoint_sends_sample_without_changing_state(tmp_path, monkeypatch):
    store, _box, jobs, _monitor, scheduler = core(tmp_path)
    received = {}

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

    def fake_post(url, content, headers, timeout):
        received.update(url=url, content=content, headers=headers, timeout=timeout)
        return Response()

    monkeypatch.setattr("dalux_build.webhook_server.delivery.httpx.post", fake_post)
    app = build_app(jobs=jobs, store=store, scheduler=scheduler, management_token="admin")
    headers = {"Authorization": "Bearer admin"}
    with TestClient(app) as client:
        request = change_request().model_dump(by_alias=True, mode="json")
        request["scope"] = {"mode": "fileIds", "fileIds": ["file-1"]}
        created = client.post(
            "/jobs/change",
            json=request,
            headers=headers,
        )
        job_id = created.json()["jobId"]
        response = client.post(f"/jobs/{job_id}/test", headers=headers)

    assert response.status_code == 200
    assert response.json()["eventType"] == "change"
    payload = json.loads(received["content"])
    assert payload["test"] is True
    assert payload["jobId"] == job_id
    assert payload["projectId"] == "p1"
    assert payload["fileAreaId"] == "fa1"
    assert payload["files"][0]["current"]["fileId"] == "file-1"
    assert payload["files"][0]["changeType"] == "modified"
    assert store.states(job_id) == {}


def test_embedded_api_can_test_a_job(tmp_path, monkeypatch):
    store, _box, jobs, _monitor, _scheduler = core(tmp_path)
    request = change_request().model_dump(by_alias=True, mode="json")
    request["scope"] = {"mode": "fileIds", "fileIds": ["file-2"]}
    view, _ = jobs.create(ChangeJobRequest.model_validate(request))

    received = {}

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

    def fake_post(url, content, headers, timeout):
        received.update(url=url, content=content, headers=headers, timeout=timeout)
        return Response()

    monkeypatch.setattr("dalux_build.webhook_server.delivery.httpx.post", fake_post)
    api = WebhookServerApi(
        ApiClient(Configuration(base_url="https://default.example/api", api_key="api-key"))
    )
    api._jobs = jobs

    response = api.test_job(view.job_id)

    assert response.event_type == "change"
    assert json.loads(received["content"])["jobId"] == view.job_id
    assert store.states(view.job_id) == {}


def test_change_baseline_then_added_modified_deleted(tmp_path, monkeypatch):
    store, _box, jobs, monitor, _scheduler = core(tmp_path)
    view, _ = jobs.create(change_request())
    pages = [{"items": [{"data": {"fileId": "f1", "fileName": "a.ifc", "fileRevisionId": "r1"}}]}]
    monkeypatch.setattr("dalux_build.webhook_server.monitor.fetch_pages", lambda *args: pages)
    row = store.get_job(view.job_id)
    assert monitor.run(row, datetime.now(timezone.utc)) is None

    pages[0]["items"][0]["data"]["fileRevisionId"] = "r2"
    row = store.get_job(view.job_id)
    delivery = monitor.run(row, datetime.now(timezone.utc))
    queued = store.pending_deliveries(utcnow())
    assert delivery is not None
    assert json.loads(queued[0]["payload_json"])["files"][0]["changeType"] == "modified"

    pages[0]["items"] = []
    row = store.get_job(view.job_id)
    monitor.run(row, datetime.now(timezone.utc))
    queued = store.pending_deliveries(utcnow())
    assert json.loads(queued[-1]["payload_json"])["files"][0]["changeType"] == "deleted"


def test_freshness_empty_selection_is_not_compliant(tmp_path, monkeypatch):
    store, _box, jobs, monitor, _scheduler = core(tmp_path)
    request = FreshnessJobRequest(
        projectId="p1",
        fileAreaId="fa1",
        daluxApiKey="secret",
        cron="0 9 * * 1",
        callback=CallbackConfig(url="https://n8n.example/fresh", authType="none"),
        fileNameFilter=FileNameFilter(extensions=["ifc"]),
        maxAge="P1D",
    )
    view, _ = jobs.create(request)
    monkeypatch.setattr(
        "dalux_build.webhook_server.monitor.fetch_pages", lambda *args: [{"items": []}]
    )
    monitor.run(store.get_job(view.job_id), datetime.now(timezone.utc))
    payload = json.loads(store.pending_deliveries(utcnow())[0]["payload_json"])
    assert payload["compliant"] is False
    assert payload["violations"] == [{"reason": "emptySelection"}]


def test_freshness_filters_files_to_selected_folders(tmp_path, monkeypatch):
    store, _box, jobs, monitor, _scheduler = core(tmp_path)
    request = FreshnessJobRequest(
        projectId="p1",
        fileAreaId="fa1",
        daluxApiKey="secret",
        cron="0 9 * * 1",
        callback=CallbackConfig(url="https://n8n.example/fresh", authType="none"),
        folderIds=["selected-folder"],
        fileNameFilter=FileNameFilter(extensions=["ifc"]),
        maxAge="P1D",
    )
    view, _ = jobs.create(request)
    pages = [
        {
            "items": [
                {
                    "data": {
                        "fileId": "selected",
                        "folderId": "selected-folder",
                        "fileName": "selected.ifc",
                        "lastModified": datetime.now(timezone.utc).date().isoformat(),
                    }
                },
                {
                    "data": {
                        "fileId": "other",
                        "folderId": "other-folder",
                        "fileName": "other.ifc",
                        "lastModified": datetime.now(timezone.utc).date().isoformat(),
                    }
                },
            ]
        }
    ]
    monkeypatch.setattr("dalux_build.webhook_server.monitor.fetch_pages", lambda *args: pages)

    monitor.run(store.get_job(view.job_id), datetime.now(timezone.utc))

    payload = json.loads(store.pending_deliveries(utcnow())[0]["payload_json"])
    assert payload["compliant"] is True
    assert payload["filesChecked"] == 1
    assert set(store.states(view.job_id)) == {"selected"}
    config = json.loads(store.get_job(view.job_id)["config_json"])
    assert config["folderIds"] == ["selected-folder"]


def test_freshness_rejects_subday_duration():
    data = {
        "projectId": "p",
        "fileAreaId": "fa",
        "daluxApiKey": "key",
        "cron": "0 0 * * *",
        "callback": {"url": "https://example.test/hook"},
        "fileNameFilter": {"extensions": ["ifc"]},
        "maxAge": "PT12H",
    }
    try:
        FreshnessJobRequest.model_validate(data)
    except ValueError:
        pass
    else:
        raise AssertionError("sub-day freshness duration must be rejected")


def test_raw_bookmark_pages_are_preserved(monkeypatch):
    page1 = {
        "items": [{"data": {"fileId": "f1"}}],
        "links": [{"rel": "nextPage", "href": "https://x/files?bookmark=b1"}],
    }
    page2 = {"items": [{"data": {"fileId": "f2"}}], "links": []}
    calls = []

    def fake_get(_self, _path, params=None):
        calls.append(params)
        return page2 if params else page1

    monkeypatch.setattr("dalux_build.api_client.ApiClient.get", fake_get)
    assert fetch_pages("https://dalux.example/api", "key", "p", "fa") == [page1, page2]
    assert calls == [None, {"bookmark": "b1"}]


def test_hmac_delivery_signs_exact_body(tmp_path, monkeypatch):
    store, box, jobs, _monitor, _scheduler = core(tmp_path)
    request = change_request("emitCurrent")
    request.callback.auth_type = "hmac-sha256"
    request.callback.secret = "signing-secret"
    view, _ = jobs.create(request)
    payload = {"type": "test", "deliveryId": "delivery-1"}
    store.commit_poll(view.job_id, [], {}, ("delivery-1", payload))
    received = {}

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

    def fake_post(url, content, headers, timeout):
        received.update(url=url, content=content, headers=headers, timeout=timeout)
        return Response()

    monkeypatch.setattr("dalux_build.webhook_server.delivery.httpx.post", fake_post)
    DeliveryWorker(store, box).drain()
    expected = hmac.new(b"signing-secret", received["content"], hashlib.sha256).hexdigest()
    assert received["headers"]["X-Webhook-Signature"] == "sha256=" + expected
    assert received["headers"]["X-Delivery-ID"] == "delivery-1"
    assert received["timeout"] == 30.0


def test_scheduler_logs_registered_jobs(tmp_path, caplog):
    store, _box, jobs, _monitor, scheduler = core(tmp_path)
    jobs.create(change_request())

    caplog.set_level("INFO", logger="dalux_build.webhook_server.scheduler")
    scheduler._log_jobs_snapshot()

    assert any("Scheduled jobs (1)" in record.message for record in caplog.records)


def test_delivery_worker_logs_send_and_success(tmp_path, caplog, monkeypatch):
    store, box, jobs, _monitor, _scheduler = core(tmp_path)
    view, _ = jobs.create(change_request("emitCurrent"))
    store.commit_poll(view.job_id, [], {}, ("delivery-1", {"deliveryId": "delivery-1"}))

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

    def fake_post(*args, **kwargs):
        return Response()

    monkeypatch.setattr("dalux_build.webhook_server.delivery.httpx.post", fake_post)
    caplog.set_level("INFO", logger="dalux_build.webhook_server.delivery")

    DeliveryWorker(store, box).drain()

    messages = [record.message for record in caplog.records]
    assert any("Sending webhook delivery delivery-1" in message for message in messages)
    assert any("succeeded with status 200" in message for message in messages)


def test_delivery_exhaustion_is_visible_in_health_state(tmp_path, monkeypatch):
    import httpx

    store, box, jobs, _monitor, _scheduler = core(tmp_path)
    view, _ = jobs.create(change_request("emitCurrent"))
    store.commit_poll(view.job_id, [], {}, ("delivery-1", {"deliveryId": "delivery-1"}))

    def fail(*args, **kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr("dalux_build.webhook_server.delivery.httpx.post", fail)
    DeliveryWorker(store, box, max_attempts=1).drain()
    assert store.failed_count() == 1
