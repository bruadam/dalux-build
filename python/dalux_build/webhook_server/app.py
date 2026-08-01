"""FastAPI application exposing the webhook receiver and a conditional download endpoint.

Endpoints:

* ``GET  /healthz``           - liveness probe.
* ``POST /webhooks/dalux``    - receive Dalux file-change webhooks.
* ``GET  /files/{file_id}``   - conditional download for pull-based clients
                                (honours ``If-None-Match`` and returns 304).

``build_app`` is a pure builder: it takes its collaborators as arguments
instead of reading settings/env vars itself, so both ``WebhookServerApi``
(embedded mode) and the standalone ``webhook-server`` CLI wrapper can wire it
up from their own configuration source without duplicating the endpoint logic.

Only ever imported lazily (from ``WebhookServerApi.start()`` or the standalone
CLI), so importing ``fastapi`` at module scope is safe.
"""

from __future__ import annotations

import os
from collections.abc import Callable

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import JsonValue

from ..json_types import JSONDict
from . import metadata, qa, webhook
from .config import QaConfig
from .service import DaluxFileService
from .store import Store
from .watchlist import WatchedFile, WatchList

QaTrigger = Callable[[QaConfig, JSONDict], None]


def _resolve(
    watchlist: WatchList,
    file_id: str,
    project_id: str | None,
    file_area_id: str | None,
) -> WatchedFile:
    watched = watchlist.get(file_id)
    if watched:
        return watched
    if project_id and file_area_id:
        return WatchedFile(project_id=project_id, file_area_id=file_area_id, file_id=file_id)
    raise HTTPException(
        status_code=404,
        detail="file_id is not on the watch list; pass project_id and file_area_id query params",
    )


def build_app(
    *,
    watchlist: WatchList,
    store: Store,
    service: DaluxFileService,
    webhook_secret: str,
    signature_header: str = "X-Dalux-Signature",
    qa_config: QaConfig | None = None,
    qa_trigger: QaTrigger | None = None,
) -> FastAPI:
    """Build a FastAPI app wired to the given collaborators.

    *qa_trigger* defaults to :func:`dalux_build.webhook_server.qa.trigger`;
    callers that need to intercept QA dispatch (e.g. the standalone CLI's own
    ``qa`` module, so its tests can monkeypatch it) can pass their own
    callable instead.
    """
    resolved_qa_config = qa_config or QaConfig()
    resolved_qa_trigger: QaTrigger = qa_trigger or qa.trigger

    app = FastAPI(title="Dalux Build webhook server", version="0.1.0")

    @app.get("/healthz")
    def healthz() -> dict[str, JsonValue]:
        return {"status": "ok", "watched_files": len(watchlist)}

    @app.post("/webhooks/dalux")
    async def receive_webhook(
        request: Request,
        signature: str | None = Header(default=None, alias=signature_header),
    ) -> JSONResponse:
        body = await request.body()
        if not webhook.verify_signature(webhook_secret, signature, body):
            raise HTTPException(status_code=401, detail="invalid signature")

        try:
            raw_payload = await request.json()
        except Exception as exc:
            raise HTTPException(status_code=400, detail="body is not valid JSON") from exc
        payload: JSONDict = raw_payload if isinstance(raw_payload, dict) else {}

        ev_id = webhook.event_id(payload)
        event_marked = False
        if ev_id:
            event_marked = store.mark_event(ev_id)
            if not event_marked:
                return JSONResponse({"status": "duplicate", "eventId": ev_id})

        processed: list[JSONDict] = []
        try:
            for ref in webhook.extract_file_refs(payload):
                if not watchlist.is_watched(ref.file_id):
                    continue
                watched = watchlist.get(ref.file_id)
                if watched is None:
                    continue
                result = service.check(
                    watched.project_id, watched.file_area_id, watched.file_id, download=True
                )
                entry: JSONDict = {
                    "fileId": result.file_id,
                    "changed": result.changed,
                    "reason": result.reason,
                    "downloadedPath": result.downloaded_path,
                }
                if result.changed:
                    resolved_qa_trigger(
                        resolved_qa_config,
                        qa.build_event(result, watched.project_id, watched.file_area_id),
                    )
                processed.append(entry)
        except Exception:
            if ev_id and event_marked:
                store.unmark_event(ev_id)
            raise

        return JSONResponse({"status": "ok", "eventId": ev_id, "processed": processed})

    @app.get("/files/{file_id}")
    def get_file(
        file_id: str,
        response: Response,
        project_id: str | None = Query(default=None),
        file_area_id: str | None = Query(default=None),
        if_none_match: str | None = Header(default=None),
    ) -> Response:
        watched = _resolve(watchlist, file_id, project_id, file_area_id)
        data = service.get_metadata(watched.project_id, watched.file_area_id, file_id)
        etag = metadata.etag_for(data)

        if etag and if_none_match and if_none_match.strip('"') == etag:
            return Response(status_code=304)

        result = service.ensure_local_copy(watched.project_id, watched.file_area_id, file_id)
        if not result.downloaded_path or not os.path.exists(result.downloaded_path):
            raise HTTPException(status_code=404, detail="file has no downloadable content")

        file_revision = data.get("fileRevisionId", "")
        headers = {"X-File-Revision": file_revision if isinstance(file_revision, str) else ""}
        if etag:
            headers["ETag"] = f'"{etag}"'
        file_name = data.get("fileName", file_id)
        return FileResponse(
            result.downloaded_path,
            filename=file_name if isinstance(file_name, str) else file_id,
            headers=headers,
        )

    return app
