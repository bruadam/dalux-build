"""Outbound QA pipeline trigger.

After a watched file is confirmed changed and downloaded, notify a downstream
QA pipeline. Two interchangeable mechanisms are supported:

* ``qa_webhook_url`` - HTTP POST a JSON event (e.g. a CI webhook, queue ingest,
  or GitHub ``repository_dispatch`` proxy); and
* ``qa_command`` - run a local command with the event JSON on stdin.

Both are optional; if neither is configured the event is only logged.

This module is only ever imported lazily (from ``WebhookServerApi.start()`` or
the standalone CLI), so importing ``httpx`` at module scope is safe.
"""

from __future__ import annotations

import json
import logging
import subprocess

import httpx

from ..json_types import JSONDict
from .config import QaConfig
from .service import CheckResult

logger = logging.getLogger("dalux_build.webhook_server.qa")


def build_event(result: CheckResult, project_id: str, file_area_id: str) -> JSONDict:
    data = result.data or {}
    return {
        "type": "dalux.file.changed",
        "projectId": project_id,
        "fileAreaId": file_area_id,
        "fileId": result.file_id,
        "fileRevisionId": data.get("fileRevisionId"),
        "contentHash": data.get("contentHash"),
        "fileName": data.get("fileName"),
        "downloadedPath": result.downloaded_path,
        "sidecarPath": result.sidecar_path,
    }


def trigger(qa_config: QaConfig, event: JSONDict) -> None:
    """Dispatch *event* to the configured QA mechanism."""
    if qa_config.qa_webhook_url:
        headers = {"Content-Type": "application/json"}
        if qa_config.qa_webhook_token:
            headers["Authorization"] = "Bearer " + qa_config.qa_webhook_token
        try:
            response = httpx.post(
                qa_config.qa_webhook_url, json=event, headers=headers, timeout=30.0
            )
            response.raise_for_status()
            logger.info("QA webhook accepted change for file %s", event.get("fileId"))
        except httpx.HTTPError as exc:
            logger.error("QA webhook failed for file %s: %s", event.get("fileId"), exc)
        return

    if qa_config.qa_command:
        try:
            subprocess.run(
                qa_config.qa_command,
                shell=True,
                input=json.dumps(event).encode("utf-8"),
                check=True,
            )
            logger.info("QA command completed for file %s", event.get("fileId"))
        except subprocess.CalledProcessError as exc:
            logger.error("QA command failed for file %s: %s", event.get("fileId"), exc)
        return

    logger.info("Change detected for file %s (no QA trigger configured)", event.get("fileId"))
