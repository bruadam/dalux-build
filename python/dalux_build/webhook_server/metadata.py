"""Change detection based on Dalux ``File`` metadata.

Field names follow ``components/schemas/File`` in
``docs/official-api-docs/Dalux Build API.yaml``:
``fileRevisionId``, ``contentHash``, ``lastModified``, ``fileSize``,
``fileName`` and ``downloadLink``.

We prefer ``contentHash`` (byte-level), then ``fileRevisionId`` (revision
level), then a ``(lastModified, fileSize)`` tuple as a last resort, so the
service stays correct even if a webhook fires for an unrelated metadata change.

Callers pass in plain camelCase dicts (see ``service.py``, which normalizes
the client's pydantic ``FileResponse``/``File`` models via
``model_dump(by_alias=True)`` before handing data to this module).
"""

from __future__ import annotations

from ..json_types import JSONDict
from .store import FileState


def _as_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _as_int(value: object) -> int | None:
    return value if isinstance(value, int) else None


def file_data(payload: JSONDict | None) -> JSONDict:
    """Unwrap the ``data`` object from a get_file response (or pass through)."""
    if not payload:
        return {}
    data = payload.get("data")
    if isinstance(data, dict):
        return data
    return payload


def etag_for(data: JSONDict) -> str | None:
    """A stable identifier for the current file content, for HTTP ETag / If-None-Match."""
    return _as_str(data.get("contentHash")) or _as_str(data.get("fileRevisionId"))


def has_changed(state: FileState | None, data: JSONDict) -> bool:
    """True when *data* represents a different file version than *state*."""
    if state is None:
        return True

    content_hash = _as_str(data.get("contentHash"))
    if content_hash and state.content_hash:
        return content_hash != state.content_hash

    revision_id = _as_str(data.get("fileRevisionId"))
    if revision_id and state.revision_id:
        return revision_id != state.revision_id

    return (
        _as_str(data.get("lastModified")) != state.last_modified
        or _as_int(data.get("fileSize")) != state.file_size
    )


def to_state(file_id: str, data: JSONDict, downloaded_path: str | None, now: float) -> FileState:
    return FileState(
        file_id=file_id,
        revision_id=_as_str(data.get("fileRevisionId")),
        content_hash=_as_str(data.get("contentHash")),
        last_modified=_as_str(data.get("lastModified")),
        file_size=_as_int(data.get("fileSize")),
        downloaded_path=downloaded_path,
        updated_at=now,
    )
