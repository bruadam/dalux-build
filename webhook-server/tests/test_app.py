from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from dalux_webhook.app import create_app
from dalux_webhook.config import Settings


def test_standalone_health_and_registration(tmp_path):
    settings = Settings(
        management_token="admin",
        master_key=Fernet.generate_key().decode(),
        dalux_base_url="https://default.example/api",
        default_timezone="UTC",
        state_db_path=str(tmp_path / "state.sqlite3"),
        host="127.0.0.1",
        port=8000,
        max_delivery_attempts=8,
    )
    with TestClient(create_app(settings)) as client:
        health = client.get("/healthz")
        assert health.status_code == 200
        assert health.json()["schedulerRunning"] is True
        response = client.post(
            "/jobs/change",
            headers={"Authorization": "Bearer admin"},
            json={
                "projectId": "p1",
                "fileAreaId": "fa1",
                "daluxApiKey": "secret",
                "cron": "*/10 * * * *",
                "scope": {"mode": "all"},
                "callback": {"url": "http://n8n:5678/webhook/dalux"},
            },
        )
        assert response.status_code == 201
        assert response.json()["daluxBaseUrl"] == "https://default.example/api"
        assert "secret" not in response.text
