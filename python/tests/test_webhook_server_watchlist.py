import json
import threading

from dalux_build.webhook_server.watchlist import WatchedFile, WatchList


def test_load_from_json(tmp_path):
    path = tmp_path / "watchlist.json"
    path.write_text(
        json.dumps(
            {
                "watch": [
                    {"project_id": "p1", "file_area_id": "fa1", "file_id": "f1"},
                    {"project_id": "p1", "file_area_id": "fa1", "file_id": "f2"},
                ]
            }
        )
    )
    wl = WatchList.load(str(path))
    assert len(wl) == 2
    assert wl.is_watched("f1")
    assert wl.get("f2") == WatchedFile("p1", "fa1", "f2")


def test_save_round_trips(tmp_path):
    path = tmp_path / "watchlist.json"
    wl = WatchList()
    wl.add(WatchedFile("p1", "fa1", "f1"))
    wl.save(str(path))

    reloaded = WatchList.load(str(path))
    assert reloaded.is_watched("f1")


def test_add_many_and_remove_many():
    wl = WatchList()
    wl.add_many(
        [
            WatchedFile("p1", "fa1", "f1"),
            WatchedFile("p1", "fa1", "f2"),
            WatchedFile("p1", "fa1", "f3"),
        ]
    )
    assert len(wl) == 3

    wl.remove_many(["f1", "f2"])
    assert len(wl) == 1
    assert wl.is_watched("f3")
    assert not wl.is_watched("f1")


def test_add_overwrites_existing_file_id():
    wl = WatchList()
    wl.add(WatchedFile("p1", "fa1", "f1"))
    wl.add(WatchedFile("p2", "fa2", "f1"))
    assert len(wl) == 1
    assert wl.get("f1").project_id == "p2"


def test_remove_missing_file_id_is_noop():
    wl = WatchList()
    wl.remove("does-not-exist")
    assert len(wl) == 0


def test_concurrent_add_remove_is_thread_safe():
    wl = WatchList()
    file_ids = [f"f{i}" for i in range(200)]

    def adder():
        for fid in file_ids:
            wl.add(WatchedFile("p1", "fa1", fid))

    def remover():
        for fid in file_ids[:100]:
            wl.remove(fid)

    threads = [threading.Thread(target=adder) for _ in range(4)] + [
        threading.Thread(target=remover) for _ in range(4)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Deterministic end state: all adders run to completion after removers in
    # the worst case, but regardless of interleaving, remaining ids must be a
    # subset of file_ids and every remaining WatchedFile must be internally
    # consistent (no torn reads/writes).
    remaining = wl.all()
    remaining_ids = {f.file_id for f in remaining}
    assert remaining_ids.issubset(set(file_ids))
    assert len(remaining) == len(remaining_ids)
