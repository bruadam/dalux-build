"""Dalux polling, snapshot normalization and monitor evaluation."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import cast
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from ..api_client import ApiClient
from ..configuration import Configuration
from ..json_types import JSONDict, JSONValue, QueryParams
from .crypto import SecretBox
from .store import Store


def _next_bookmark(page: JSONDict) -> str | None:
    links = page.get("links")
    if not isinstance(links, list):
        return None
    for link in links:
        if isinstance(link, dict) and link.get("rel") == "nextPage":
            href = link.get("href")
            if isinstance(href, str):
                return parse_qs(urlparse(href).query).get("bookmark", [None])[0]
    return None


def fetch_pages(base_url: str, api_key: str, project_id: str, file_area_id: str) -> list[JSONDict]:
    """Fetch and retain every raw page from the documented files endpoint."""
    client = ApiClient(Configuration(base_url=base_url, api_key=api_key))
    path = f"/6.1/projects/{project_id}/file_areas/{file_area_id}/files"
    pages: list[JSONDict] = []
    bookmark: str | None = None
    seen: set[str] = set()
    while True:
        params: QueryParams | None = {"bookmark": bookmark} if bookmark else None
        value = client.get(path, params=params)
        if not isinstance(value, dict):
            break
        page = value
        pages.append(page)
        bookmark = _next_bookmark(page)
        if not bookmark or bookmark in seen:
            break
        seen.add(bookmark)
    return pages


def normalize(pages: list[JSONDict]) -> dict[str, JSONDict]:
    result: dict[str, JSONDict] = {}
    for page in pages:
        items = page.get("items")
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            data = item.get("data", item)
            if not isinstance(data, dict):
                continue
            file_id = data.get("fileId")
            if isinstance(file_id, str):
                result[file_id] = data
    return result


def _matches(name: str, rules: JSONDict) -> bool:
    value = name.lower()

    def lowered(key: str) -> list[str]:
        raw = rules.get(key)
        return [str(part).lower() for part in raw] if isinstance(raw, list) else []

    contains = lowered("contains")
    if contains:
        checks = [part in value for part in contains]
        if not (all(checks) if rules.get("contains_match", "any") == "all" else any(checks)):
            return False
    if any(part in value for part in lowered("not_contains")):
        return False
    if any(value.startswith(part) for part in lowered("not_startswith")):
        return False
    if any(value.endswith(part) for part in lowered("not_endswith")):
        return False
    excluded = [part if part.startswith(".") else "." + part for part in lowered("not_extensions")]
    if any(value.endswith(part) for part in excluded):
        return False
    starts = lowered("startswith")
    if starts and not any(value.startswith(part) for part in starts):
        return False
    ends = lowered("endswith")
    if ends and not any(value.endswith(part) for part in ends):
        return False
    extensions = [part if part.startswith(".") else "." + part for part in lowered("extensions")]
    if extensions and not any(value.endswith(part) for part in extensions):
        return False
    return True


def _fingerprint(data: JSONDict) -> tuple[object, ...]:
    return tuple(
        data.get(key)
        for key in ("fileRevisionId", "contentHash", "lastModified", "fileSize", "deleted")
    )


class Monitor:
    def __init__(self, store: Store, secrets: SecretBox) -> None:
        self.store = store
        self.secrets = secrets

    def run(self, row: sqlite3.Row, scheduled_at: datetime) -> str | None:
        pages = fetch_pages(
            row["base_url"],
            self.secrets.decrypt(row["api_key_encrypted"]),
            row["project_id"],
            row["file_area_id"],
        )
        current_all = normalize(pages)
        previous = self.store.states(row["job_id"])
        config = cast(JSONDict, json.loads(row["config_json"]))
        checked = datetime.now(timezone.utc)
        delivery_id = str(uuid.uuid4())

        if row["kind"] == "change":
            scope = cast(JSONDict, config["scope"])
            if scope["mode"] == "fileIds":
                ids = {str(value) for value in cast(list[object], scope["fileIds"])}
                current = {fid: data for fid, data in current_all.items() if fid in ids}
                prior = {fid: data for fid, data in previous.items() if fid in ids}
            else:
                current, prior = current_all, previous
            changes: list[JSONDict] = []
            initialized = bool(row["initialized"])
            for fid in sorted(set(current) | set(prior)):
                now, old = current.get(fid), prior.get(fid)
                if now is None and old is not None and not bool(old.get("deleted")):
                    changes.append({"changeType": "deleted", "current": None, "previous": old})
                elif now is not None and bool(now.get("deleted")):
                    if old is None or not bool(old.get("deleted")):
                        changes.append({"changeType": "deleted", "current": now, "previous": old})
                elif old is None and now is not None:
                    if initialized or config.get("initialRun") == "emitCurrent":
                        changes.append({"changeType": "added", "current": now, "previous": None})
                elif now is not None and old is not None and _fingerprint(now) != _fingerprint(old):
                    changes.append({"changeType": "modified", "current": now, "previous": old})
            payload: JSONDict | None = None
            if changes:
                payload = {
                    "type": "dalux.files.changed",
                    "deliveryId": delivery_id,
                    "jobId": row["job_id"],
                    "projectId": row["project_id"],
                    "fileAreaId": row["file_area_id"],
                    "scheduledAt": scheduled_at.isoformat(),
                    "checkedAt": checked.isoformat(),
                    "files": [cast(JSONValue, change) for change in changes],
                }
            self.store.commit_poll(
                row["job_id"],
                pages,
                current,
                (delivery_id, payload) if payload is not None else None,
            )
            return delivery_id if payload else None

        rules = cast(JSONDict, config["fileNameFilter"])
        folder_ids = {
            str(value) for value in cast(list[object], config.get("folderIds", []))
        }
        current = {
            fid: data
            for fid, data in current_all.items()
            if (not folder_ids or str(data.get("folderId", "")) in folder_ids)
            and _matches(str(data.get("fileName", "")), rules)
        }
        previously_matching = {
            fid: data
            for fid, data in previous.items()
            if (not folder_ids or str(data.get("folderId", "")) in folder_ids)
            and _matches(str(data.get("fileName", "")), rules)
        }
        days = int(str(config["maxAge"])[1:-1])
        local_date = checked.astimezone(ZoneInfo(row["timezone"])).date()
        cutoff = local_date - timedelta(days=days)
        violations: list[JSONDict] = []
        for fid in sorted(set(current) | set(previously_matching)):
            data = current.get(fid)
            if data is None:
                violations.append(
                    {"reason": "missing", "fileId": fid, "previous": previously_matching[fid]}
                )
                continue
            if bool(data.get("deleted")):
                violations.append({"reason": "deleted", "fileId": fid, "file": data})
                continue
            raw_date = data.get("lastModified")
            try:
                modified = date.fromisoformat(str(raw_date))
            except ValueError:
                violations.append({"reason": "missingLastModified", "fileId": fid, "file": data})
                continue
            if modified < cutoff:
                violations.append({"reason": "stale", "fileId": fid, "file": data})
        if not current and not previously_matching:
            violations.append({"reason": "emptySelection"})
        payload = {
            "type": "dalux.files.freshness",
            "deliveryId": delivery_id,
            "jobId": row["job_id"],
            "projectId": row["project_id"],
            "fileAreaId": row["file_area_id"],
            "scheduledAt": scheduled_at.isoformat(),
            "checkedAt": checked.isoformat(),
            "maxAge": config["maxAge"],
            "compliant": not violations,
            "filesChecked": len(current),
            "violations": [cast(JSONValue, violation) for violation in violations],
        }
        retained = dict(current)
        retained.update(
            {fid: data for fid, data in previously_matching.items() if fid not in current}
        )
        self.store.commit_poll(row["job_id"], pages, retained, (delivery_id, payload))
        return delivery_id
