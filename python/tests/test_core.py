"""Tests for Configuration and ApiClient."""
import os
import pytest
import responses as rsps_lib

from dalux_build.configuration import Configuration
from dalux_build.api_client import ApiClient

BASE_URL = "https://api.example.com/build"
API_KEY = "test-key-abc"


# ---------- Configuration ----------

class TestConfiguration:
    def test_stores_base_url_and_api_key(self):
        config = Configuration(base_url=BASE_URL, api_key=API_KEY)
        assert config.base_url == BASE_URL
        assert config.api_key == API_KEY

    def test_strips_trailing_slash(self):
        config = Configuration(base_url=BASE_URL + "/", api_key=API_KEY)
        assert config.base_url == BASE_URL

    def test_raises_when_base_url_missing(self, monkeypatch):
        # Clear env vars to ensure they don't interfere
        monkeypatch.delenv("DALUX_API_BASE_URL", raising=False)
        monkeypatch.delenv("DALUX_API_KEY", raising=False)
        with pytest.raises(ValueError, match="base_url"):
            Configuration(base_url="", api_key=API_KEY)

    def test_raises_when_api_key_missing(self, monkeypatch):
        # Mock getenv to return None for our env vars to avoid loading from .env
        def mock_getenv(key, default=None):
            if key == "DALUX_API_KEY":
                return None
            if key == "DALUX_API_BASE_URL":
                return None
            return os.environ.get(key, default)

        monkeypatch.setattr("os.getenv", mock_getenv)
        with pytest.raises(ValueError, match="api_key"):
            Configuration(base_url=BASE_URL, api_key="")


# ---------- ApiClient ----------

@rsps_lib.activate
def test_api_client_requires_configuration():
    with pytest.raises((ValueError, TypeError)):
        ApiClient(None)


@rsps_lib.activate
def test_get_sends_api_key_header():
    rsps_lib.add(
        rsps_lib.GET, f"{BASE_URL}/5.1/projects", json={"items": []}, status=200
    )
    config = Configuration(base_url=BASE_URL, api_key=API_KEY)
    client = ApiClient(config)
    client.get("/5.1/projects")
    assert rsps_lib.calls[0].request.headers["X-API-KEY"] == API_KEY


@rsps_lib.activate
def test_get_sends_query_params():
    rsps_lib.add(
        rsps_lib.GET, f"{BASE_URL}/5.1/projects", json={}, status=200
    )
    config = Configuration(base_url=BASE_URL, api_key=API_KEY)
    client = ApiClient(config)
    client.get("/5.1/projects", params={"updatedAfter": "2024-01-01"})
    assert "updatedAfter=2024-01-01" in rsps_lib.calls[0].request.url


@rsps_lib.activate
def test_post_sends_json_body():
    rsps_lib.add(
        rsps_lib.POST, f"{BASE_URL}/5.0/projects", json={"id": "p1"}, status=201
    )
    config = Configuration(base_url=BASE_URL, api_key=API_KEY)
    client = ApiClient(config)
    result = client.post("/5.0/projects", json={"name": "My Project"})
    assert result == {"id": "p1"}
    assert b'"name"' in rsps_lib.calls[0].request.body


@rsps_lib.activate
def test_patch_sends_json_body():
    rsps_lib.add(
        rsps_lib.PATCH, f"{BASE_URL}/5.0/projects/p1", json={"id": "p1"}, status=200
    )
    config = Configuration(base_url=BASE_URL, api_key=API_KEY)
    client = ApiClient(config)
    result = client.patch("/5.0/projects/p1", json={"name": "Updated"})
    assert result == {"id": "p1"}


@rsps_lib.activate
def test_delete_request():
    rsps_lib.add(
        rsps_lib.DELETE, f"{BASE_URL}/5.0/projects/p1", status=204
    )
    config = Configuration(base_url=BASE_URL, api_key=API_KEY)
    client = ApiClient(config)
    result = client.delete("/5.0/projects/p1")
    assert result is None


@rsps_lib.activate
def test_http_error_raises():
    rsps_lib.add(
        rsps_lib.GET, f"{BASE_URL}/5.0/projects/bad", json={"message": "Not found"}, status=404
    )
    config = Configuration(base_url=BASE_URL, api_key=API_KEY)
    client = ApiClient(config)
    with pytest.raises(Exception):
        client.get("/5.0/projects/bad")
