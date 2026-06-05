"""Change detection based on Dalux ``File`` metadata.

Field names follow ``components/schemas/File`` in
``docs/official-api-docs/Dalux Build API.yaml``:
``fileRevisionId``, ``contentHash``, ``lastModified``, ``fileSize``,
``fileName`` and ``downloadLink``.

We prefer ``contentHash`` (byte-level), then ``fileRevisionId`` (revision
level), then a ``(lastModified, fileSize)`` tuple as a last resort, so the
service stays correct even if a webhook fires for an unrelated metadata change.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from .store import FileState


def file_data(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Unwrap the ``data`` object from a get_file response (or pass through)."""
    if not payload:
        return {}
    if isinstance(payload.get("data"), dict):
        return payload["data"]
    return payload


def etag_for(data: Dict[str, Any]) -> Optional[str]:
    """A stable identifier for the current file content, for HTTP ETag / If-None-Match."""
    return data.get("contentHash") or data.get("fileRevisionId")


def has_changed(state: Optional[FileState], data: Dict[str, Any]) -> bool:
    """True when *data* represents a different file version than *state*."""
    if state is None:
        return True

    content_hash = data.get("contentHash")
    if content_hash and state.content_hash:
        return content_hash != state.content_hash

    revision_id = data.get("fileRevisionId")
    if revision_id and state.revision_id:
        return revision_id != state.revision_id

    return (
        data.get("lastModified") != state.last_modified
        or data.get("fileSize") != state.file_size
    )


def to_state(file_id: str, data: Dict[str, Any], downloaded_path: Optional[str], now: float) -> FileState:
    return FileState(
        file_id=file_id,
        revision_id=data.get("fileRevisionId"),
        content_hash=data.get("contentHash"),
        last_modified=data.get("lastModified"),
        file_size=data.get("fileSize"),
        downloaded_path=downloaded_path,
        updated_at=now,
    )
