"""Webhook signature verification and payload parsing.

The Dalux Build OpenAPI document does not define webhooks, so the exact payload
shape and signing scheme are not guaranteed. This module therefore:

* verifies an HMAC-SHA256 signature (the most common scheme) using a configured
  shared secret, tolerating a ``sha256=`` prefix; and
* extracts file references defensively from several plausible payload shapes.

Adjust :func:`extract_file_refs` once you have a real example payload from Dalux.
"""
from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


def verify_signature(secret: str, header_value: Optional[str], body: bytes) -> bool:
    """Constant-time HMAC-SHA256 check of the raw request body.

    If *secret* is empty, verification is disabled and this returns True
    (intended only for local testing).
    """
    if not secret:
        return True
    if not header_value:
        return False
    provided = header_value.split("=", 1)[1] if "=" in header_value else header_value
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided.strip())


@dataclass(frozen=True)
class FileRef:
    file_id: str
    project_id: Optional[str] = None
    file_area_id: Optional[str] = None


def _first(d: Dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = d.get(key)
        if value:
            return str(value)
    return None


def event_id(payload: Dict[str, Any]) -> Optional[str]:
    """Best-effort extraction of a unique event id for idempotency."""
    return _first(payload, "eventId", "event_id", "id", "deliveryId", "delivery_id")


def _ref_from_obj(obj: Dict[str, Any]) -> Optional[FileRef]:
    file_id = _first(obj, "fileId", "file_id")
    if not file_id:
        return None
    return FileRef(
        file_id=file_id,
        project_id=_first(obj, "projectId", "project_id"),
        file_area_id=_first(obj, "fileAreaId", "file_area_id"),
    )


def extract_file_refs(payload: Dict[str, Any]) -> List[FileRef]:
    """Pull file references out of a webhook payload, tolerating shape variations.

    Handles a top-level file object, a ``data`` wrapper, and an ``events`` /
    ``items`` list of file objects. Deduplicates by ``file_id``.
    """
    candidates: List[Dict[str, Any]] = []
    if isinstance(payload, dict):
        candidates.append(payload)
        if isinstance(payload.get("data"), dict):
            candidates.append(payload["data"])
        for key in ("events", "items", "files"):
            seq = payload.get(key)
            if isinstance(seq, list):
                candidates.extend(item for item in seq if isinstance(item, dict))

    refs: Dict[str, FileRef] = {}
    for obj in candidates:
        ref = _ref_from_obj(obj)
        if ref and ref.file_id not in refs:
            refs[ref.file_id] = ref
    return list(refs.values())
