"""Thin wrapper around the ``dalux_build`` client for the webhook service.

Centralises the metadata-first, then bytes flow: fetch single-file metadata
(no download), compare with stored state, and only stream the file when it
actually changed.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from dalux_build import create_client

from . import ifc_metadata, metadata
from .config import Settings
from .store import FileState, Store


@dataclass
class CheckResult:
    file_id: str
    changed: bool
    data: Dict[str, Any]
    downloaded_path: Optional[str] = None
    sidecar_path: Optional[str] = None
    reason: str = ""


class DaluxService:
    def __init__(self, settings: Settings, store: Store) -> None:
        settings.require_dalux()
        self._settings = settings
        self._store = store
        self._client = create_client(
            base_url=settings.dalux_base_url,
            api_key=settings.dalux_api_key,
        )

    def get_metadata(self, project_id: str, file_area_id: str, file_id: str) -> Dict[str, Any]:
        """Return the Dalux ``File`` object (the ``data`` payload) without downloading."""
        response = self._client.files.get_file(project_id, file_area_id, file_id)
        return metadata.file_data(response)

    def list_all_files(
        self, project_id: str, file_area_id: str, params: Optional[Dict[str, Any]] = None
    ) -> list:
        """List every file in an area (follows pagination). Used by the poller."""
        return self._client.files.get_all_files(project_id, file_area_id, params=params)

    def download(self, file_id: str, data: Dict[str, Any]) -> Optional[str]:
        """Download the file via its ``downloadLink`` and write a sidecar.

        Returns the local file path, or None if the file has no download link
        (e.g. a deleted file).
        """
        download_link = data.get("downloadLink")
        if not download_link:
            return None
        file_name = data.get("fileName", file_id)
        os.makedirs(self._settings.download_dir, exist_ok=True)
        path = self._client.files.download_file_from_link(
            download_link, file_name, self._settings.download_dir
        )
        ifc_metadata.write_sidecar(path, data)
        return path

    def check(
        self,
        project_id: str,
        file_area_id: str,
        file_id: str,
        download: bool = True,
    ) -> CheckResult:
        """Fetch metadata, compare with stored state, optionally download if changed."""
        data = self.get_metadata(project_id, file_area_id, file_id)
        state = self._store.get_state(file_id)

        if not metadata.has_changed(state, data):
            return CheckResult(file_id, False, data, reason="unchanged")

        downloaded_path: Optional[str] = None
        sidecar: Optional[str] = None
        if download:
            downloaded_path = self.download(file_id, data)
            if downloaded_path:
                sidecar = ifc_metadata.sidecar_path(downloaded_path)

        self._store.save_state(
            metadata.to_state(file_id, data, downloaded_path, time.time())
        )
        return CheckResult(
            file_id,
            True,
            data,
            downloaded_path=downloaded_path,
            sidecar_path=sidecar,
            reason="changed",
        )

    def ensure_local_copy(
        self, project_id: str, file_area_id: str, file_id: str
    ) -> CheckResult:
        """Guarantee a current local copy exists, for pull-based serving.

        Re-downloads when the file changed upstream or the cached copy is
        missing on disk; otherwise reuses the cached path.
        """
        data = self.get_metadata(project_id, file_area_id, file_id)
        state = self._store.get_state(file_id)
        cached = state.downloaded_path if state else None
        is_current = (
            not metadata.has_changed(state, data)
            and cached
            and os.path.exists(cached)
        )
        if is_current:
            return CheckResult(file_id, False, data, downloaded_path=cached, reason="cached")

        path = self.download(file_id, data)
        sidecar = ifc_metadata.sidecar_path(path) if path else None
        self._store.save_state(metadata.to_state(file_id, data, path, time.time()))
        return CheckResult(
            file_id, True, data, downloaded_path=path, sidecar_path=sidecar, reason="downloaded"
        )
