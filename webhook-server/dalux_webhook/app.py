"""FastAPI application exposing the webhook receiver and a conditional download endpoint.

Endpoints:

* ``GET  /healthz``           - liveness probe.
* ``POST /webhooks/dalux``    - receive Dalux file-change webhooks.
* ``GET  /files/{file_id}``   - conditional download for pull-based clients
                                (honours ``If-None-Match`` and returns 304).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse

from . import metadata, qa, webhook
from .config import Settings, get_settings
from .dalux import DaluxService
from .store import Store
from .watchlist import WatchList, WatchedFile

logger = logging.getLogger("dalux_webhook.app")


class AppContext:
    """Holds the long-lived collaborators wired from settings."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.store = Store(settings.state_db_path)
        self.watchlist = (
            WatchList.load(settings.watchlist_path)
            if os.path.exists(settings.watchlist_path)
            else WatchList([])
        )
        self.dalux = DaluxService(settings, self.store)


def _resolve(
    ctx: AppContext,
    file_id: str,
    project_id: Optional[str],
    file_area_id: Optional[str],
) -> WatchedFile:
    watched = ctx.watchlist.get(file_id)
    if watched:
        return watched
    if project_id and file_area_id:
        return WatchedFile(project_id=project_id, file_area_id=file_area_id, file_id=file_id)
    raise HTTPException(
        status_code=404,
        detail="file_id is not on the watch list; pass project_id and file_area_id query params",
    )


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Dalux Build webhook server", version="0.1.0")
    ctx = AppContext(settings)
    app.state.ctx = ctx

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok", "watched_files": len(ctx.watchlist)}

    @app.post("/webhooks/dalux")
    async def receive_webhook(
        request: Request,
        signature: Optional[str] = Header(default=None, alias=settings.webhook_signature_header),
    ) -> JSONResponse:
        body = await request.body()
        if not webhook.verify_signature(settings.webhook_secret, signature, body):
            raise HTTPException(status_code=401, detail="invalid signature")

        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="body is not valid JSON")

        ev_id = webhook.event_id(payload)
        if ev_id and not ctx.store.mark_event(ev_id):
            return JSONResponse({"status": "duplicate", "eventId": ev_id})

        processed = []
        for ref in webhook.extract_file_refs(payload):
            if not ctx.watchlist.is_watched(ref.file_id):
                continue
            watched = ctx.watchlist.get(ref.file_id)
            result = ctx.dalux.check(
                watched.project_id, watched.file_area_id, watched.file_id, download=True
            )
            entry = {
                "fileId": result.file_id,
                "changed": result.changed,
                "reason": result.reason,
                "downloadedPath": result.downloaded_path,
            }
            if result.changed:
                qa.trigger(settings, qa.build_event(result, watched.project_id, watched.file_area_id))
            processed.append(entry)

        return JSONResponse({"status": "ok", "eventId": ev_id, "processed": processed})

    @app.get("/files/{file_id}")
    def get_file(
        file_id: str,
        response: Response,
        project_id: Optional[str] = Query(default=None),
        file_area_id: Optional[str] = Query(default=None),
        if_none_match: Optional[str] = Header(default=None),
    ):
        watched = _resolve(ctx, file_id, project_id, file_area_id)
        data = ctx.dalux.get_metadata(watched.project_id, watched.file_area_id, file_id)
        etag = metadata.etag_for(data)

        if etag and if_none_match and if_none_match.strip('"') == etag:
            return Response(status_code=304)

        result = ctx.dalux.ensure_local_copy(
            watched.project_id, watched.file_area_id, file_id
        )
        if not result.downloaded_path or not os.path.exists(result.downloaded_path):
            raise HTTPException(status_code=404, detail="file has no downloadable content")

        headers = {"X-File-Revision": data.get("fileRevisionId", "")}
        if etag:
            headers["ETag"] = f'"{etag}"'
        return FileResponse(
            result.downloaded_path,
            filename=data.get("fileName", file_id),
            headers=headers,
        )

    return app


app = None


def get_app() -> FastAPI:
    """Lazy app factory used by ``uvicorn dalux_webhook.app:get_app --factory``."""
    return create_app()
