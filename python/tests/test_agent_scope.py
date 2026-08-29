"""Tests for AgentScope resolution and PDF-file scoping."""

import pytest

from dalux_build.ai.agent.errors import AgentScopeError
from dalux_build.ai.agent.scope import AgentScope, resolve_pdf_files, resolve_scope
from dalux_build.models import File, Folder


class _Configuration:
    def __init__(self, project_id="p1", file_area_id=None):
        self.project_id = project_id
        self.file_area_id = file_area_id


class _FileAreasApi:
    def __init__(self, file_area_id="fa1", file_area_name="Files"):
        self._file_area_id = file_area_id
        self._file_area_name = file_area_name

    def get_file_area_by_name(self, name, *, project_id=None):
        return self._file_area_id if name == self._file_area_name else None


class _FolderResponse:
    def __init__(self, folder_id):
        self.data = Folder(folderId=folder_id, folderName="Contracts", parentFolderId=None)


class _FoldersApi:
    def __init__(self, folder_id="f1", found=True):
        self._folder_id = folder_id
        self._found = found

    def get_folder_by_path(self, path, *, project_id=None):
        return _FolderResponse(self._folder_id) if self._found else None


class _FilesApi:
    def __init__(self, files):
        self._files = files
        self.calls = []

    def get_files(self, **kwargs):
        self.calls.append(("get_files", kwargs))
        return self._files

    def get_files_in_folder(self, **kwargs):
        self.calls.append(("get_files_in_folder", kwargs))
        return self._files


class _Client:
    def __init__(self, files=None, file_area_id="fa1", folder_id="f1", found_folder=True):
        self.configuration = _Configuration()
        self.file_areas = _FileAreasApi(file_area_id=file_area_id)
        self.folders = _FoldersApi(folder_id=folder_id, found=found_folder)
        self.files = _FilesApi(files or [])


def _pdf_file(file_id, name="contract.pdf", file_type=None):
    return File(
        fileId=file_id,
        fileName=name,
        fileAreaId="fa1",
        downloadLink=f"https://example.test/{file_id}",
        fileType=file_type,
    )


def test_resolve_scope_with_explicit_file_area_id():
    client = _Client()

    scope = resolve_scope(client, file_area_id="fa1")

    assert scope == AgentScope(project_id="p1", file_area_id="fa1", folder_id=None)


def test_resolve_scope_with_path_resolves_file_area_and_folder():
    client = _Client()

    scope = resolve_scope(client, path="Files/Contracts")

    assert scope == AgentScope(project_id="p1", file_area_id="fa1", folder_id="f1")


def test_resolve_scope_rejects_folder_id_and_path_together():
    client = _Client()

    with pytest.raises(AgentScopeError, match="not both"):
        resolve_scope(client, folder_id="f1", path="Files/Contracts")


def test_resolve_scope_unknown_path_raises():
    client = _Client(found_folder=False)

    with pytest.raises(AgentScopeError, match="No folder found"):
        resolve_scope(client, path="Files/Nowhere")


def test_scope_cache_key_is_deterministic_and_scope_specific():
    scope_a = AgentScope(project_id="p1", file_area_id="fa1", folder_id="f1")
    scope_b = AgentScope(project_id="p1", file_area_id="fa1", folder_id="f1")
    scope_c = AgentScope(project_id="p1", file_area_id="fa1", folder_id="f2")

    assert scope_a.cache_key() == scope_b.cache_key()
    assert scope_a.cache_key() != scope_c.cache_key()


def test_resolve_pdf_files_filters_by_extension():
    files = [_pdf_file("1", "contract.pdf"), _pdf_file("2", "photo.jpg")]
    client = _Client(files=files)
    scope = AgentScope(project_id="p1", file_area_id="fa1", folder_id=None)

    # file_type=None isolates this test to the extension filter alone.
    result = resolve_pdf_files(client, scope, file_type=None)

    assert [f.file_id for f in result] == ["1"]


def test_resolve_pdf_files_uses_folder_listing_when_scoped():
    files = [_pdf_file("1")]
    client = _Client(files=files)
    scope = AgentScope(project_id="p1", file_area_id="fa1", folder_id="f1")

    resolve_pdf_files(client, scope, recursive=True)

    call_name, kwargs = client.files.calls[0]
    assert call_name == "get_files_in_folder"
    assert kwargs["folder_id"] == "f1"
    assert kwargs["subfolders"] is True


def test_resolve_pdf_files_defaults_to_document_file_type():
    files = [
        _pdf_file("1", file_type="document"),
        _pdf_file("2", file_type="drawing"),
        _pdf_file("3", file_type=None),
    ]
    client = _Client(files=files)
    scope = AgentScope(project_id="p1", file_area_id="fa1", folder_id=None)

    result = resolve_pdf_files(client, scope)

    assert [f.file_id for f in result] == ["1"]


def test_resolve_pdf_files_drawings_always_excluded_even_without_file_type_filter():
    files = [_pdf_file("1", file_type="document"), _pdf_file("2", file_type="drawing")]
    client = _Client(files=files)
    scope = AgentScope(project_id="p1", file_area_id="fa1", folder_id=None)

    result = resolve_pdf_files(client, scope, file_type=None)

    assert [f.file_id for f in result] == ["1"]


def test_resolve_pdf_files_unmatched_file_type_returns_empty():
    files = [_pdf_file("1", file_type="document"), _pdf_file("2", file_type="drawing")]
    client = _Client(files=files)
    scope = AgentScope(project_id="p1", file_area_id="fa1", folder_id=None)

    result = resolve_pdf_files(client, scope, file_type="not-a-real-type")

    assert result == []
