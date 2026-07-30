from dalux_build.webhook_server.config import QaConfig
from dalux_build.webhook_server.qa import trigger


def test_trigger_sends_bearer_token_to_webhook(monkeypatch):
    calls = []

    class Response:
        def raise_for_status(self):
            return None

    def fake_post(url, json, headers, timeout):
        calls.append(
            {
                "url": url,
                "json": json,
                "headers": headers,
                "timeout": timeout,
            }
        )
        return Response()

    monkeypatch.setattr("dalux_build.webhook_server.qa.httpx.post", fake_post)

    trigger(
        QaConfig(
            qa_webhook_url="https://qa.example.test/hook",
            qa_webhook_token="secret-token",
        ),
        {"fileId": "f1"},
    )

    assert len(calls) == 1
    assert calls[0]["url"] == "https://qa.example.test/hook"
    assert calls[0]["json"] == {"fileId": "f1"}
    assert calls[0]["timeout"] == 30.0
    assert calls[0]["headers"]["Content-Type"] == "application/json"
    assert calls[0]["headers"]["Authorization"].startswith("Bearer ")
    assert calls[0]["headers"]["Authorization"].endswith("secret-token")
