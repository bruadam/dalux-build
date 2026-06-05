from dalux_webhook.store import FileState, Store


def test_save_and_get_state(tmp_path):
    store = Store(str(tmp_path / "state.sqlite3"))
    assert store.get_state("f1") is None

    store.save_state(
        FileState("f1", "r1", "abc", "2024-01-01", 10, "/tmp/f1.ifc", 1.0)
    )
    got = store.get_state("f1")
    assert got.revision_id == "r1"
    assert got.content_hash == "abc"

    store.save_state(
        FileState("f1", "r2", "xyz", "2024-02-01", 20, "/tmp/f1.ifc", 2.0)
    )
    assert store.get_state("f1").revision_id == "r2"
    store.close()


def test_mark_event_idempotency(tmp_path):
    store = Store(str(tmp_path / "state.sqlite3"))
    assert store.mark_event("e1") is True
    assert store.mark_event("e1") is False
    assert store.mark_event("e2") is True
    store.close()
