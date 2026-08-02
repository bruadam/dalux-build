"""Persistent outbound webhook delivery."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import sqlite3
from datetime import timedelta
from typing import Literal

import httpx

from ..json_types import JSONDict
from .crypto import SecretBox
from .models import CallbackConfig, TestWebhookResponse
from .store import Store, utcnow

logger = logging.getLogger(__name__)


def _headers(delivery_id: str, auth_type: str, secret: str, body: bytes) -> dict[str, str]:
    headers = {"Content-Type": "application/json", "X-Delivery-ID": delivery_id}
    if auth_type == "bearer":
        headers["Authorization"] = "Bearer " + secret
    elif auth_type == "hmac-sha256":
        signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        headers["X-Webhook-Signature"] = "sha256=" + signature
    return headers


def send_test_webhook(
    callback: CallbackConfig,
    event_type: Literal["change", "freshness"],
    payload: JSONDict,
) -> TestWebhookResponse:
    """Send a prebuilt test event without altering job state or the persistent outbox."""
    delivery_id = str(payload["deliveryId"])
    body = json.dumps(payload, separators=(",", ":")).encode()
    response = httpx.post(
        str(callback.url),
        content=body,
        headers=_headers(delivery_id, callback.auth_type, callback.secret or "", body),
        timeout=30.0,
    )
    response.raise_for_status()
    logger.info(
        "Test webhook delivered successfully to %s with status %s",
        callback.url,
        response.status_code,
    )
    return TestWebhookResponse(
        deliveryId=delivery_id, eventType=event_type, statusCode=response.status_code
    )


class DeliveryWorker:
    def __init__(self, store: Store, secrets: SecretBox, max_attempts: int = 8) -> None:
        self.store = store
        self.secrets = secrets
        self.max_attempts = max_attempts

    def drain(self) -> None:
        for row in self.store.pending_deliveries(utcnow()):
            self._deliver(row)

    def _deliver(self, row: sqlite3.Row) -> None:
        body = row["payload_json"].encode()
        encrypted = row["callback_secret_encrypted"]
        secret = self.secrets.decrypt(encrypted) if encrypted else ""
        headers = _headers(row["delivery_id"], row["callback_auth_type"], secret, body)
        attempts = int(row["attempts"]) + 1
        try:
            logger.info(
                "Sending webhook delivery %s for job %s to %s",
                row["delivery_id"],
                row["job_id"],
                row["callback_url"],
            )
            response = httpx.post(row["callback_url"], content=body, headers=headers, timeout=30.0)
            response.raise_for_status()
            logger.info(
                "Webhook delivery %s for job %s succeeded with status %s",
                row["delivery_id"],
                row["job_id"],
                response.status_code,
            )
            self.store.delivery_result(
                row["delivery_id"], success=True, attempts=attempts, next_at=utcnow()
            )
        except httpx.HTTPError as exc:
            logger.warning(
                "Webhook delivery %s for job %s failed: %s",
                row["delivery_id"],
                row["job_id"],
                exc,
            )
            if attempts >= self.max_attempts:
                self.store.fail_delivery(row["delivery_id"], attempts, str(exc))
            else:
                delay = min(900, 10 * (2 ** (attempts - 1)))
                self.store.delivery_result(
                    row["delivery_id"],
                    success=False,
                    attempts=attempts,
                    next_at=utcnow() + timedelta(seconds=delay),
                    error=str(exc),
                )
