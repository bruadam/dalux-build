import os

from dalux_webhook import ifc_metadata


def test_write_and_read_sidecar(tmp_path):
    ifc = tmp_path / "Model.ifc"
    ifc.write_bytes(b"ISO-10303-21;")
    data = {
        "fileId": "f1",
        "fileRevisionId": "r1",
        "contentHash": "abc",
        "fileName": "Model.ifc",
        "fileSize": 13,
    }
    sidecar = ifc_metadata.write_sidecar(str(ifc), data)
    assert sidecar.endswith(".ifc.dalux.json")
    assert os.path.exists(sidecar)

    loaded = ifc_metadata.read_sidecar(str(ifc))
    assert loaded["fileRevisionId"] == "r1"
    assert "downloadedAt" in loaded


def test_matches_sidecar(tmp_path):
    ifc = tmp_path / "Model.ifc"
    ifc.write_bytes(b"x")
    ifc_metadata.write_sidecar(str(ifc), {"contentHash": "abc", "fileRevisionId": "r1"})

    assert ifc_metadata.matches_sidecar(str(ifc), {"contentHash": "abc"}) is True
    assert ifc_metadata.matches_sidecar(str(ifc), {"contentHash": "zzz"}) is False
    # falls back to revision id when no content hash on the new data
    assert ifc_metadata.matches_sidecar(str(ifc), {"fileRevisionId": "r1"}) is True


def test_matches_sidecar_missing(tmp_path):
    ifc = tmp_path / "Nope.ifc"
    assert ifc_metadata.matches_sidecar(str(ifc), {"contentHash": "abc"}) is False
