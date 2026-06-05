from dalux_webhook import metadata
from dalux_webhook.store import FileState


def _state(**kwargs):
    base = dict(
        file_id="f1",
        revision_id=None,
        content_hash=None,
        last_modified=None,
        file_size=None,
        downloaded_path=None,
        updated_at=0.0,
    )
    base.update(kwargs)
    return FileState(**base)


def test_unwraps_data():
    assert metadata.file_data({"data": {"fileId": "f1"}}) == {"fileId": "f1"}
    assert metadata.file_data({"fileId": "f1"}) == {"fileId": "f1"}
    assert metadata.file_data(None) == {}


def test_has_changed_no_prior_state():
    assert metadata.has_changed(None, {"contentHash": "abc"}) is True


def test_has_changed_prefers_content_hash():
    state = _state(content_hash="abc", revision_id="r1")
    assert metadata.has_changed(state, {"contentHash": "abc", "fileRevisionId": "r2"}) is False
    assert metadata.has_changed(state, {"contentHash": "xyz", "fileRevisionId": "r1"}) is True


def test_has_changed_revision_fallback():
    state = _state(revision_id="r1")
    assert metadata.has_changed(state, {"fileRevisionId": "r1"}) is False
    assert metadata.has_changed(state, {"fileRevisionId": "r2"}) is True


def test_has_changed_last_modified_size_fallback():
    state = _state(last_modified="2024-01-01", file_size=10)
    assert metadata.has_changed(state, {"lastModified": "2024-01-01", "fileSize": 10}) is False
    assert metadata.has_changed(state, {"lastModified": "2024-02-01", "fileSize": 10}) is True


def test_etag_prefers_content_hash():
    assert metadata.etag_for({"contentHash": "h", "fileRevisionId": "r"}) == "h"
    assert metadata.etag_for({"fileRevisionId": "r"}) == "r"
    assert metadata.etag_for({}) is None
