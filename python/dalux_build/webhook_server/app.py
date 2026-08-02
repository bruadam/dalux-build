"""Authenticated HTTP management API for scheduled monitors."""

from __future__ import annotations

import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Response, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .controller import Jobs
from .models import (
    ChangeJobRequest,
    FreshnessJobRequest,
    JobUpdateRequest,
    JobView,
    TestWebhookResponse,
)
from .scheduler import Scheduler
from .store import Store


def build_app(*, jobs: Jobs, store: Store, scheduler: Scheduler, management_token: str) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        scheduler.start()
        try:
            yield
        finally:
            scheduler.stop()

    app = FastAPI(title="Dalux scheduled monitor", version="1.0.0", lifespan=lifespan)
    bearer = HTTPBearer(
        auto_error=False,
        scheme_name="MONITOR_API_TOKEN",
        description="Paste only the MONITOR_API_TOKEN value. Swagger adds the Bearer prefix.",
    )

    def authorize(
        credentials: HTTPAuthorizationCredentials | None = Security(bearer),  # noqa: B008
    ) -> None:
        if credentials is None or not hmac.compare_digest(
            credentials.credentials, management_token
        ):
            raise HTTPException(status_code=401, detail="invalid bearer token")

    @app.get("/healthz")
    def healthz() -> dict[str, object]:
        return {
            "status": "ok" if scheduler.running else "starting",
            "schedulerRunning": scheduler.running,
            "failedDeliveries": store.failed_count(),
        }

    @app.post("/jobs/change", response_model=JobView, status_code=status.HTTP_201_CREATED)
    def create_change(
        request: ChangeJobRequest,
        response: Response,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
        _auth: None = Depends(authorize),
    ) -> JobView:
        try:
            view, created = jobs.create(request, idempotency_key)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not created:
            response.status_code = status.HTTP_200_OK
        return view

    @app.post("/jobs/freshness", response_model=JobView, status_code=status.HTTP_201_CREATED)
    def create_freshness(
        request: FreshnessJobRequest,
        response: Response,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
        _auth: None = Depends(authorize),
    ) -> JobView:
        try:
            view, created = jobs.create(request, idempotency_key)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not created:
            response.status_code = status.HTTP_200_OK
        return view

    @app.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_job(job_id: str, _auth: None = Depends(authorize)) -> Response:
        jobs.delete(job_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.patch("/jobs/{job_id}", response_model=JobView)
    def update_job(
        job_id: str, request: JobUpdateRequest, _auth: None = Depends(authorize)
    ) -> JobView:
        try:
            return jobs.set_enabled(job_id, request.enabled)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc

    @app.post("/jobs/{job_id}/test", response_model=TestWebhookResponse)
    def test_job_webhook(job_id: str, _auth: None = Depends(authorize)) -> TestWebhookResponse:
        try:
            return jobs.test_webhook(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"test webhook failed: {exc}") from exc

    return app
