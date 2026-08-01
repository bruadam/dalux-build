"""File Upload API (chunked upload)."""

from ..api_client import ApiClient
from ..json_types import JSONDict, JSONValue
from ..utils.validation import resolve_file_area_id, resolve_project_id


class FileUploadApi:
    """Methods for chunked file uploads."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def create_upload(
        self,
        body: JSONDict,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> JSONValue | None:
        """POST /1.0/.../upload — Create an upload slot and return its GUID."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        return self._client.post(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}/upload",
            json=body,
        )

    def upload_file_part(
        self,
        upload_guid: str,
        chunk: bytes,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> JSONValue | None:
        """POST /1.0/.../upload/{uploadGuid} — Upload a binary file chunk."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        return self._client.post(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}/upload/{upload_guid}",
            data=chunk,
            headers={"Content-Type": "application/octet-stream"},
        )

    def finish_upload(
        self,
        upload_guid: str,
        body: JSONDict,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> JSONValue | None:
        """POST /2.0/.../upload/{uploadGuid}/finalize — Finalize the upload."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        return self._client.post(
            f"/2.0/projects/{project_id}/file_areas/{file_area_id}/upload/{upload_guid}/finalize",
            json=body,
        )
