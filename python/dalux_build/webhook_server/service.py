"""Thin wrapper around the shared ``FilesApi`` for the webhook service.

Centralises the metadata-first, then bytes flow: fetch single-file metadata
(no download), compare with stored state, and only stream the file when it
actually changed.

Takes the parent ``DaluxClient``'s already-authenticated ``FilesApi`` instance
rather than building its own client/session, so there is exactly one HTTP
session and one set of credentials per ``DaluxClient``.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

from ..api.files import FileLike, FilesApi
from ..json_types import JSONDict, QueryParams
from ..models import FileResponse
from . import ifc_metadata, metadata
from .store import Store


@dataclass
class CheckResult:
    file_id: str
    changed: bool
    data: JSONDict
    downloaded_path: str | None = None
    sidecar_path: str | None = None
    reason: str = ""


class DaluxFileService:
    def __init__(self, files_api: FilesApi, download_dir: str, store: Store) -> None:
        self._files_api = files_api
        self._download_dir = download_dir
        self._store = store

    def get_metadata(self, project_id: str, file_area_id: str, file_id: str) -> JSONDict:
        """Return the Dalux ``File`` object (camelCase dict) without downloading."""
        response = self._files_api.get_file(
            file_id, project_id=project_id, file_area_id=file_area_id
        )
        if not isinstance(response, FileResponse) or response.data is None:
            return {}
        dumped: JSONDict = response.data.model_dump(by_alias=True)
        return dumped

    def list_all_files(
        self, project_id: str, file_area_id: str, params: QueryParams | None = None
    ) -> list[FileLike]:
        """List every file in an area (follows pagination). Used by the poller."""
        return self._files_api.get_all_files(
            params=params, project_id=project_id, file_area_id=file_area_id
        )

    def download(self, file_id: str, data: JSONDict) -> str | None:
        """Download the file via its ``downloadLink`` and write a sidecar.

        Returns the local file path, or None if the file has no download link
        (e.g. a deleted file).
        """
        download_link = data.get("downloadLink")
        if not isinstance(download_link, str):
            return None
        file_name_value = data.get("fileName", file_id)
        file_name = file_name_value if isinstance(file_name_value, str) else file_id
        os.makedirs(self._download_dir, exist_ok=True)
        path = self._files_api.download_file_from_link(download_link, file_name, self._download_dir)
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

        downloaded_path: str | None = None
        sidecar: str | None = None
        if download:
            downloaded_path = self.download(file_id, data)
            if downloaded_path:
                sidecar = ifc_metadata.sidecar_path(downloaded_path)

        self._store.save_state(metadata.to_state(file_id, data, downloaded_path, time.time()))
        return CheckResult(
            file_id,
            True,
            data,
            downloaded_path=downloaded_path,
            sidecar_path=sidecar,
            reason="changed",
        )

    def ensure_local_copy(self, project_id: str, file_area_id: str, file_id: str) -> CheckResult:
        """Guarantee a current local copy exists, for pull-based serving.

        Re-downloads when the file changed upstream or the cached copy is
        missing on disk; otherwise reuses the cached path.
        """
        data = self.get_metadata(project_id, file_area_id, file_id)
        state = self._store.get_state(file_id)
        cached = state.downloaded_path if state else None
        is_current = not metadata.has_changed(state, data) and cached and os.path.exists(cached)
        if is_current:
            return CheckResult(file_id, False, data, downloaded_path=cached, reason="cached")

        path = self.download(file_id, data)
        sidecar = ifc_metadata.sidecar_path(path) if path else None
        self._store.save_state(metadata.to_state(file_id, data, path, time.time()))
        return CheckResult(
            file_id, True, data, downloaded_path=path, sidecar_path=sidecar, reason="downloaded"
        )
