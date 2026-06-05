"""Attach Dalux provenance to downloaded files via a JSON sidecar.

We use the sidecar strategy (plan option A): for ``Model.ifc`` we write
``Model.ifc.dalux.json`` next to it. This keeps the IFC bytes untouched (no
risk of breaking viewers or STEP parsers) while giving QA pipelines a stable
fingerprint to compare against before re-processing a model.

If you later need the metadata embedded inside the IFC model graph, add an
IfcOpenShell-based writer here that creates an ``IfcPropertySet`` on
``IfcProject``; the comparison helpers below stay the same.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

SIDECAR_SUFFIX = ".dalux.json"

_FIELDS = (
    "fileId",
    "fileRevisionId",
    "contentHash",
    "fileName",
    "fileSize",
    "lastModified",
    "version",
)


def sidecar_path(file_path: str) -> str:
    return file_path + SIDECAR_SUFFIX


def build_provenance(data: Dict[str, Any]) -> Dict[str, Any]:
    """Pick the comparison-relevant fields from a Dalux ``File`` object."""
    provenance = {key: data.get(key) for key in _FIELDS if data.get(key) is not None}
    provenance["downloadedAt"] = datetime.now(timezone.utc).isoformat()
    return provenance


def write_sidecar(file_path: str, data: Dict[str, Any]) -> str:
    """Write ``<file_path>.dalux.json`` and return its path."""
    path = sidecar_path(file_path)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(build_provenance(data), handle, indent=2, sort_keys=True)
    return path


def read_sidecar(file_path: str) -> Optional[Dict[str, Any]]:
    path = sidecar_path(file_path)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def matches_sidecar(file_path: str, data: Dict[str, Any]) -> bool:
    """True if the on-disk sidecar already describes this file version.

    Lets a QA job (or the poller) skip re-downloading when the local artifact
    is current, comparing ``contentHash`` first, then ``fileRevisionId``.
    """
    existing = read_sidecar(file_path)
    if not existing:
        return False
    if data.get("contentHash") and existing.get("contentHash"):
        return data["contentHash"] == existing["contentHash"]
    if data.get("fileRevisionId") and existing.get("fileRevisionId"):
        return data["fileRevisionId"] == existing["fileRevisionId"]
    return False
