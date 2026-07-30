"""End-to-end lifecycle tests for WebhookServerApi.start()/register()/stop().

Requires the 'webhook' extra (fastapi/uvicorn) to run.
"""
import socket

import pytest

from dalux_build.api_client import ApiClient
from dalux_build.configuration import Configuration
from dalux_build.webhook_server.api import WebhookServerApi
from dalux_build.webhook_server.errors import WebhookServerAlreadyRunning


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def api_client():
    config = Configuration(base_url="https://example.dalux.com/api", api_key="k")
    return ApiClient(config)


def test_register_before_start_works(api_client):
    server = WebhookServerApi(api_client)
    server.register(project_id="p1", file_area_id="fa1", file_ids=["f1", "f2"])
    assert len(server.list_watched()) == 2
    assert server.is_running is False
    assert server.url is None


def test_start_register_stop_lifecycle(api_client, tmp_path):
    server = WebhookServerApi(api_client)
    port = _free_port()

    server.start(
        host="127.0.0.1",
        port=port,
        secret="s3cret",
        state_db_path=str(tmp_path / "state.sqlite3"),
        download_dir=str(tmp_path / "downloads"),
    )
    try:
        assert server.is_running is True
        assert server.url == f"http://127.0.0.1:{port}"
        assert server.webhook_url == f"http://127.0.0.1:{port}/webhooks/dalux"

        server.register(project_id="p1", file_area_id="fa1", file_ids=["f1", "f2", "f3"])
        assert len(server.list_watched()) == 3

        with pytest.raises(WebhookServerAlreadyRunning):
            server.start(host="127.0.0.1", port=port)

        server.unregister(file_ids=["f1"])
        assert len(server.list_watched()) == 2
    finally:
        server.stop()

    assert server.is_running is False
    # stop() before/after start is idempotent, never raises
    server.stop()


def test_stop_before_start_is_noop(api_client):
    server = WebhookServerApi(api_client)
    server.stop()
    assert server.is_running is False


def test_watchlist_persists_across_restarts(api_client, tmp_path):
    watchlist_path = str(tmp_path / "watchlist.json")

    server = WebhookServerApi(api_client)
    port = _free_port()
    server.start(
        host="127.0.0.1",
        port=port,
        watchlist_path=watchlist_path,
        state_db_path=str(tmp_path / "state.sqlite3"),
        download_dir=str(tmp_path / "downloads"),
    )
    try:
        server.register(project_id="p1", file_area_id="fa1", file_ids=["f1"])
    finally:
        server.stop()

    server2 = WebhookServerApi(api_client)
    port2 = _free_port()
    server2.start(
        host="127.0.0.1",
        port=port2,
        watchlist_path=watchlist_path,
        state_db_path=str(tmp_path / "state2.sqlite3"),
        download_dir=str(tmp_path / "downloads2"),
    )
    try:
        assert len(server2.list_watched()) == 1
        assert server2.list_watched()[0].file_id == "f1"
    finally:
        server2.stop()
