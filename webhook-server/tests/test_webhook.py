import hashlib
import hmac

from dalux_webhook import webhook


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_verify_signature_valid_and_prefixed():
    body = b'{"eventId": "1"}'
    sig = _sign("s3cret", body)
    assert webhook.verify_signature("s3cret", sig, body) is True
    assert webhook.verify_signature("s3cret", f"sha256={sig}", body) is True


def test_verify_signature_invalid_or_missing():
    body = b"{}"
    assert webhook.verify_signature("s3cret", "deadbeef", body) is False
    assert webhook.verify_signature("s3cret", None, body) is False


def test_verify_signature_disabled_when_no_secret():
    assert webhook.verify_signature("", None, b"{}") is True


def test_extract_file_refs_handles_shapes():
    flat = {"fileId": "f1", "projectId": "p1", "fileAreaId": "fa1"}
    assert webhook.extract_file_refs(flat) == [
        webhook.FileRef("f1", "p1", "fa1")
    ]

    wrapped = {"data": {"file_id": "f2", "project_id": "p2", "file_area_id": "fa2"}}
    assert webhook.extract_file_refs(wrapped)[0].file_id == "f2"

    listed = {"events": [{"fileId": "a"}, {"fileId": "b"}, {"fileId": "a"}]}
    ids = [r.file_id for r in webhook.extract_file_refs(listed)]
    assert ids == ["a", "b"]


def test_event_id_variants():
    assert webhook.event_id({"eventId": "x"}) == "x"
    assert webhook.event_id({"delivery_id": "y"}) == "y"
    assert webhook.event_id({}) is None
