"""Tests to verify all API endpoints return Pydantic models, not dicts."""
import json
from datetime import date, datetime

import pytest
import responses as rsps_lib

from dalux_build import create_client
from dalux_build.api_client import ApiClient
from dalux_build.configuration import Configuration
from dalux_build.api import (
    ProjectsApi, FileAreasApi, FilesApi, FoldersApi, UsersApi,
    CompaniesApi, CompanyCatalogApi, VersionSetsApi, TasksApi,
    TestPlansApi, FormsApi, InspectionPlansApi,
)
from dalux_build.models import (
    ProjectsListResponse, ProjectResponse, Project,
    FileAreasListResponse, FileAreaResponse, FileArea,
    FilesListResponse, FileResponse, File, FileNameFilter,
    FoldersListResponse, FolderResponse, Folder,
    UsersListResponse, UserResponse, User,
    CompaniesListResponse, CompanyResponse,
    VersionSetsListResponse, VersionSetResponse,
    Task,
    TaskAttachmentsListResponse,
    TaskChange,
        TaskChangeActor,
        TaskChangeFields,
    TaskChanges,
    TaskResponse,
    TasksListResponse,
    TestPlansListResponse,
    FormsListResponse, FormResponse,
    InspectionPlansListResponse,
)

BASE_URL = "https://api.example.com/build"
API_KEY = "test-key-abc"


def _make_client():
    """Return a real ApiClient whose HTTP layer is intercepted by `responses`."""
    config = Configuration(base_url=BASE_URL, api_key=API_KEY)
    return ApiClient(config)


def _reg(method, path, body=None, status=200):
    """Register a `responses` mock for BASE_URL + path."""
    rsps_lib.add(method, f"{BASE_URL}{path}", json=body if body is not None else {}, status=status)


class TestProjectsPydantic:
    """Verify ProjectsApi returns Pydantic models."""

    @rsps_lib.activate
    def test_list_projects_returns_pydantic_model(self):
        """list_projects should return ProjectsListResponse, not dict."""
        _reg(rsps_lib.GET, "/5.1/projects", body={
            "items": [
                {
                    "projectId": "p1",
                    "projectName": "Project 1",
                    "type": "Building"
                }
            ],
            "metadata": {"totalItems": 1}
        })
        api = ProjectsApi(_make_client())
        response = api.list_projects()

        # Check it's a Pydantic model, not a dict
        assert isinstance(response, ProjectsListResponse)
        assert not isinstance(response, dict)

        # Check we can access typed properties
        assert len(response.items) == 1
        assert isinstance(response.items[0], Project)
        assert response.items[0].project_id == "p1"
        assert response.items[0].project_name == "Project 1"
        assert response.metadata.total_items == 1

    @rsps_lib.activate
    def test_get_project_returns_pydantic_model(self):
        """get_project should return ProjectResponse (Pydantic)."""
        _reg(rsps_lib.GET, "/5.0/projects/p1", body={
            "data": {
                "projectId": "p1",
                "projectName": "My Project",
                "type": "Building"
            }
        })
        api = ProjectsApi(_make_client())
        response = api.get_project("p1")

        assert isinstance(response, ProjectResponse)
        assert isinstance(response.data, Project)
        assert response.data.project_id == "p1"

    @rsps_lib.activate
    def test_create_project_returns_pydantic_model(self):
        """create_project should return ProjectResponse."""
        _reg(rsps_lib.POST, "/5.0/projects", body={
            "data": {
                "projectId": "p_new",
                "projectName": "New Project",
                "type": "Building"
            }
        }, status=201)
        api = ProjectsApi(_make_client())
        response = api.create_project({"projectName": "New Project"})

        assert isinstance(response, ProjectResponse)
        assert response.data.project_id == "p_new"

    @rsps_lib.activate
    def test_get_project_by_name(self):
        """get_project_by_name should work with Pydantic models."""
        _reg(rsps_lib.GET, "/5.1/projects", body={
            "items": [
                {"projectId": "p1", "projectName": "Project One", "type": "Building"},
                {"projectId": "p2", "projectName": "Project Two", "type": "Building"},
            ]
        })
        api = ProjectsApi(_make_client())
        project_id = api.get_project_by_name("Project Two")

        assert project_id == "p2"


class TestFileAreasPydantic:
    """Verify FileAreasApi returns Pydantic models."""

    @rsps_lib.activate
    def test_get_file_areas_returns_pydantic_model(self):
        """get_file_areas should return FileAreasListResponse."""
        _reg(rsps_lib.GET, "/5.1/projects/p1/file_areas", body={
            "items": [
                {"fileAreaId": "fa1", "fileAreaName": "Main", "fileAreaType": "Drawings"}
            ]
        })
        api = FileAreasApi(_make_client())
        response = api.get_file_areas("p1")

        assert isinstance(response, FileAreasListResponse)
        assert len(response.items) == 1
        assert isinstance(response.items[0], FileArea)
        assert response.items[0].file_area_name == "Main"

    @rsps_lib.activate
    def test_get_file_area_returns_pydantic_model(self):
        """get_file_area should return FileArea."""
        _reg(rsps_lib.GET, "/1.0/projects/p1/file_areas/fa1", body={
            "fileAreaId": "fa1",
            "fileAreaName": "Main",
            "fileAreaType": "Drawings",
        })
        api = FileAreasApi(_make_client())
        response = api.get_file_area("p1", "fa1")

        assert isinstance(response, FileArea)
        assert response.file_area_id == "fa1"
        assert response.file_area_name == "Main"

    @rsps_lib.activate
    def test_get_file_area_by_name(self):
        """get_file_area_by_name works with Pydantic models."""
        _reg(rsps_lib.GET, "/5.1/projects/p1/file_areas", body={
            "items": [
                {"fileAreaId": "fa1", "fileAreaName": "Main", "fileAreaType": "Drawings"},
                {"fileAreaId": "fa2", "fileAreaName": "Shop", "fileAreaType": "Drawings"},
            ]
        })
        api = FileAreasApi(_make_client())
        file_area_id = api.get_file_area_by_name("p1", "Shop")

        assert file_area_id == "fa2"


class TestFilesPydantic:
    """Verify FilesApi returns Pydantic models."""

    @rsps_lib.activate
    def test_list_files_returns_pydantic_model(self):
        """list_files should return FilesListResponse."""
        _reg(rsps_lib.GET, "/6.1/projects/p1/file_areas/fa1/files", body={
            "items": [
                {
                    "data": {
                        "fileId": "f1",
                        "fileName": "document.pdf",
                        "fileType": "pdf",
                        "fileAreaId": "fa1"
                    }
                }
            ]
        })
        api = FilesApi(_make_client())
        response = api.list_files("p1", "fa1")

        assert isinstance(response, FilesListResponse)
        assert len(response.items) == 1

    @rsps_lib.activate
    def test_get_file_returns_pydantic_model(self):
        """get_file should return FileResponse."""
        _reg(rsps_lib.GET, "/5.0/projects/p1/file_areas/fa1/files/f1", body={
            "data": {
                "fileId": "f1",
                "fileName": "document.pdf",
                "fileType": "pdf",
                "fileAreaId": "fa1"
            }
        })
        api = FilesApi(_make_client())
        response = api.get_file("p1", "fa1", "f1")

        assert isinstance(response, FileResponse)
        assert response.data.file_id == "f1"

    def test_bulk_download_folder_supports_filters_and_metadata(self, monkeypatch, tmp_path):
        """bulk_download_folder should filter and write metadata for downloaded files."""
        api = FilesApi(_make_client())
        file_obj = File.model_validate(
            {
                "fileId": "f1",
                "fileName": "LLYN.B250_K01_F03.ifc",
                "fileAreaId": "fa1",
                "folderId": "fo1",
                "downloadLink": "https://download.example.com/f1",
                "uploaded": date(2026, 7, 2),
            }
        )

        def fake_get_all_files_in_folder(project_id, file_area_id_or_path, folder_id=None, params=None, verbose=False):
            assert file_area_id_or_path == "Files/4_Design/C07_Geometry/C07.05_BIM"
            assert folder_id is None
            return [file_obj]

        def fake_download(download_link, file_name, save_path=None, verbose=False):
            target = tmp_path / file_name
            target.write_text("content", encoding="utf-8")
            return str(target)

        monkeypatch.setattr(api, "get_all_files_in_folder", fake_get_all_files_in_folder)
        monkeypatch.setattr(api, "_download_file_from_link", fake_download)

        results = api.bulk_download_folder(
            "p1",
            "Files/4_Design/C07_Geometry/C07.05_BIM",
            save_path=str(tmp_path),
            save_metadata=True,
            filters=FileNameFilter(contains=["B250"], extensions=["ifc"]),
        )

        assert len(results) == 1
        assert results[0].saved_file_path == str(tmp_path / "LLYN.B250_K01_F03.ifc")
        assert results[0].saved_metadata_path == str(tmp_path / "LLYN.B250_K01_F03.ifc.txt")

        with open(tmp_path / "LLYN.B250_K01_F03.ifc.txt", "r", encoding="utf-8") as metadata_file:
            metadata = json.load(metadata_file)
        assert metadata["file_id"] == "f1"
        assert metadata["uploaded"] == "2026-07-02"

    def test_bulk_download_folder_skips_when_metadata_matches(self, monkeypatch, tmp_path):
        """bulk_download_folder should skip unchanged files when saved metadata matches."""
        api = FilesApi(_make_client())
        file_obj = File.model_validate(
            {
                "fileId": "f1",
                "fileRevisionId": "r1",
                "fileName": "LLYN.B250_K01_F03.ifc",
                "fileAreaId": "fa1",
                "folderId": "fo1",
                "downloadLink": "https://download.example.com/f1",
                "uploaded": date(2026, 7, 2),
            }
        )
        local_file = tmp_path / "LLYN.B250_K01_F03.ifc"
        local_file.write_text("existing", encoding="utf-8")
        metadata_path = tmp_path / "LLYN.B250_K01_F03.ifc.txt"
        metadata_path.write_text(
            json.dumps(
                {
                    "file_revision_id": "r1",
                    "uploaded": "2026-07-02",
                }
            ),
            encoding="utf-8",
        )

        monkeypatch.setattr(
            api,
            "get_all_files_in_folder",
            lambda project_id, file_area_id_or_path, folder_id=None, params=None, verbose=False: [file_obj],
        )

        def fail_download(*args, **kwargs):
            raise AssertionError("download should be skipped when metadata matches")

        monkeypatch.setattr(api, "_download_file_from_link", fail_download)

        results = api.bulk_download_folder(
            "p1",
            "fa1",
            folder_id="fo1",
            save_path=str(tmp_path),
        )

        assert len(results) == 1
        assert results[0].saved_file_path == str(local_file)
        assert results[0].saved_metadata_path == str(metadata_path)


class TestFoldersPydantic:
    """Verify FoldersApi returns Pydantic models."""

    @rsps_lib.activate
    def test_list_folders_returns_pydantic_model(self):
        """list_folders should return FoldersListResponse."""
        _reg(rsps_lib.GET, "/5.1/projects/p1/file_areas/fa1/folders", body={
            "items": [
                {
                    "folderId": "fold1",
                    "folderName": "Level 1",
                    "folderType": "folder"
                }
            ]
        })
        api = FoldersApi(_make_client())
        response = api.list_folders("p1", "fa1")

        assert isinstance(response, FoldersListResponse)
        assert len(response.items) == 1
        assert isinstance(response.items[0], Folder)
        assert response.items[0].folder_name == "Level 1"

    @rsps_lib.activate
    def test_get_folder_returns_pydantic_model(self):
        """get_folder should return FolderResponse."""
        _reg(rsps_lib.GET, "/5.0/projects/p1/file_areas/fa1/folders/fold1", body={
            "data": {
                "folderId": "fold1",
                "folderName": "Level 1",
                "folderType": "folder"
            }
        })
        api = FoldersApi(_make_client())
        response = api.get_folder("p1", "fa1", "fold1")

        assert isinstance(response, FolderResponse)
        assert response.data.folder_id == "fold1"


class TestUsersPydantic:
    """Verify UsersApi returns Pydantic models."""

    @rsps_lib.activate
    def test_get_user_returns_pydantic_model(self):
        """get_user should return UserResponse."""
        _reg(rsps_lib.GET, "/1.1/users/u1", body={
            "data": {
                "userId": "u1",
                "userName": "john.doe",
                "email": "john@example.com",
                "userType": "User"
            }
        })
        api = UsersApi(_make_client())
        response = api.get_user("u1")

        assert isinstance(response, UserResponse)
        assert response.data.user_id == "u1"

    @rsps_lib.activate
    def test_list_project_users_returns_pydantic_model(self):
        """list_project_users should return UsersListResponse."""
        _reg(rsps_lib.GET, "/1.2/projects/p1/users", body={
            "items": [
                {
                    "userId": "u1",
                    "userName": "john.doe",
                    "email": "john@example.com",
                    "userType": "User"
                }
            ]
        })
        api = UsersApi(_make_client())
        response = api.list_project_users("p1")

        assert isinstance(response, UsersListResponse)
        assert len(response.items) == 1
        assert isinstance(response.items[0], User)


class TestCompaniesPydantic:
    """Verify CompaniesApi returns Pydantic models."""

    @rsps_lib.activate
    def test_list_project_companies_returns_pydantic_model(self):
        """list_project_companies should return CompaniesListResponse."""
        _reg(rsps_lib.GET, "/3.1/projects/p1/companies", body={
            "items": [
                {
                    "companyId": "c1",
                    "name": "Acme Corp"
                }
            ]
        })
        api = CompaniesApi(_make_client())
        response = api.list_project_companies("p1")

        assert isinstance(response, CompaniesListResponse)
        assert len(response.items) == 1

    @rsps_lib.activate
    def test_get_project_company_returns_pydantic_model(self):
        """get_project_company should return CompanyResponse."""
        _reg(rsps_lib.GET, "/3.0/projects/p1/companies/c1", body={
            "data": {
                "companyId": "c1",
                "name": "Acme Corp"
            }
        })
        api = CompaniesApi(_make_client())
        response = api.get_project_company("p1", "c1")

        assert isinstance(response, CompanyResponse)


class TestVersionSetsPydantic:
    """Verify VersionSetsApi returns Pydantic models."""

    @rsps_lib.activate
    def test_get_version_sets_returns_pydantic_model(self):
        """get_version_sets should return VersionSetsListResponse."""
        _reg(rsps_lib.GET, "/2.1/projects/p1/version_sets", body={
            "items": [
                {"versionSetId": "vs1", "name": "Revision 1", "fileAreaId": "fa1"}
            ]
        })
        api = VersionSetsApi(_make_client())
        response = api.get_version_sets("p1")

        assert isinstance(response, VersionSetsListResponse)

    @rsps_lib.activate
    def test_get_version_set_returns_pydantic_model(self):
        """get_version_set should return VersionSetResponse."""
        _reg(rsps_lib.GET, "/2.0/projects/p1/version_sets/vs1", body={
            "data": {
                "versionSetId": "vs1",
                "name": "Revision 1",
                "fileAreaId": "fa1"
            }
        })
        api = VersionSetsApi(_make_client())
        response = api.get_version_set("p1", "vs1")

        assert isinstance(response, VersionSetResponse)


class TestTasksPydantic:
    """Verify TasksApi returns Pydantic models."""

    @rsps_lib.activate
    def test_get_project_tasks_returns_pydantic_model(self):
        """get_project_tasks should return TasksListResponse."""
        _reg(rsps_lib.GET, "/5.2/projects/p1/tasks", body={
            "items": [
                {
                    "data": {
                        "taskId": "t1",
                        "title": "Task 1"
                    }
                }
            ]
        })
        api = TasksApi(_make_client())
        response = api.get_project_tasks("p1")

        assert isinstance(response, TasksListResponse)

    @rsps_lib.activate
    def test_get_task_returns_pydantic_model(self):
        """get_task should return TaskResponse."""
        _reg(rsps_lib.GET, "/3.3/projects/p1/tasks/t1", body={
            "data": {
                "taskId": "t1",
                "title": "Task 1"
            }
        })
        api = TasksApi(_make_client())
        response = api.get_task("p1", "t1")

        assert isinstance(response, TaskResponse)

    @rsps_lib.activate
    def test_get_all_project_tasks_returns_typed_items(self):
        """get_all_project_tasks should return list[ApiTaskGet]."""
        page1 = {
            "items": [{"data": {"taskId": "t1", "title": "Task 1"}}],
            "metadata": {"totalRemainingItems": 1},
            "links": [
                {
                    "rel": "nextPage",
                    "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=bm1",
                    "method": "GET",
                }
            ],
        }
        page2 = {
            "items": [{"data": {"taskId": "t2", "title": "Task 2"}}],
            "metadata": {"totalRemainingItems": 0},
            "links": [],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page2, status=200)

        api = TasksApi(_make_client())
        response = api.get_all_project_tasks("p1")

        assert len(response) == 2
        assert all(isinstance(item, Task) for item in response)
        assert response[0].task_id == "t1"
        assert response[1].task_id == "t2"

    @rsps_lib.activate
    def test_get_project_task_changes_returns_pydantic_model(self):
        """get_project_task_changes should return TaskChanges."""
        _reg(rsps_lib.GET, "/2.2/projects/p1/tasks/changes", body=[
            {
                "taskId": "S339368766909448192",
                "description": "",
                "timestamp": "2025-08-05T07:55:56.9900000+00:00",
                "action": "reject",
                "fields": {
                    "modifiedBy": {"userId": ""},
                    "assignedTo": {"roleId": "", "roleName": ""},
                    "currentResponsible": {"userId": ""},
                },
            }
        ])
        api = TasksApi(_make_client())
        response = api.get_project_task_changes("p1")

        assert isinstance(response, TaskChanges)
        assert len(response.items) == 1
        assert response.items[0].task_id == "S339368766909448192"
        assert isinstance(response.items[0].fields, TaskChangeFields)
        assert isinstance(response.items[0].fields.modified_by, TaskChangeActor)
        assert response.items[0].fields.modified_by.user_id == ""
        assert response.items[0].fields.assigned_to.role_id == ""
        assert response.items[0].fields.current_responsible.user_id == ""

    @rsps_lib.activate
    def test_get_all_project_task_changes_returns_typed_items(self):
        """get_all_project_task_changes should return list[TaskChange]."""
        page1 = {
            "items": [
                {
                    "taskId": "t1",
                    "description": "",
                    "timestamp": "2025-08-05T07:55:56.9900000+00:00",
                    "action": "create",
                    "fields": {},
                }
            ],
            "metadata": {"totalRemainingItems": 1},
            "links": [
                {
                    "rel": "nextPage",
                    "href": f"{BASE_URL}/2.2/projects/p1/tasks/changes?bookmark=bm1",
                    "method": "GET",
                }
            ],
        }
        page2 = {
            "items": [
                {
                    "taskId": "t2",
                    "description": "",
                    "timestamp": "2025-08-05T08:55:56.9900000+00:00",
                    "action": "reject",
                    "fields": {},
                }
            ],
            "metadata": {"totalRemainingItems": 0},
            "links": [],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/2.2/projects/p1/tasks/changes", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/2.2/projects/p1/tasks/changes", json=page2, status=200)

        api = TasksApi(_make_client())
        response = api.get_all_project_task_changes("p1")

        assert len(response) == 2
        assert all(isinstance(item, TaskChange) for item in response)
        assert response[0].task_id == "t1"
        assert response[1].task_id == "t2"

    @rsps_lib.activate
    def test_get_all_project_task_changes_parses_wrapped_deadline(self):
        """Task change fields.deadline can be wrapped as {'value': iso_datetime}."""
        _reg(rsps_lib.GET, "/2.2/projects/p1/tasks/changes", body={
            "items": [
                {
                    "taskId": "t3",
                    "description": "",
                    "timestamp": "2025-08-05T09:55:56.9900000+00:00",
                    "action": "update",
                    "fields": {
                        "deadline": {"value": "2025-07-16T00:00:00.0000000+00:00"}
                    },
                }
            ],
            "metadata": {"totalRemainingItems": 0},
            "links": [],
        })
        api = TasksApi(_make_client())
        response = api.get_all_project_task_changes("p1")

        assert len(response) == 1
        assert response[0].fields is not None
        assert response[0].fields.deadline is not None

    @rsps_lib.activate
    def test_get_all_project_task_changes_parses_empty_deadline_wrapper(self):
        """Task change fields.deadline can be wrapped as {'empty': true}."""
        _reg(rsps_lib.GET, "/2.2/projects/p1/tasks/changes", body={
            "items": [
                {
                    "taskId": "t4",
                    "description": "",
                    "timestamp": "2025-08-05T10:55:56.9900000+00:00",
                    "action": "update",
                    "fields": {
                        "deadline": {"empty": True}
                    },
                }
            ],
            "metadata": {"totalRemainingItems": 0},
            "links": [],
        })
        api = TasksApi(_make_client())
        response = api.get_all_project_task_changes("p1")

        assert len(response) == 1
        assert response[0].fields is not None
        assert response[0].fields.deadline is None

    @rsps_lib.activate
    def test_get_project_task_attachments_returns_pydantic_model(self):
        """get_project_task_attachments should return TaskAttachmentsListResponse."""
        _reg(rsps_lib.GET, "/1.1/projects/p1/tasks/attachments", body={
            "items": [
                {
                    "attachmentId": "a1",
                    "taskId": "t1",
                    "fileId": "f1",
                }
            ]
        })
        api = TasksApi(_make_client())
        response = api.get_project_task_attachments("p1")

        assert isinstance(response, TaskAttachmentsListResponse)
        assert len(response.items) == 1
        assert response.items[0].attachment_id == "a1"


class TestTestPlansPydantic:
    """Verify TestPlansApi returns Pydantic models."""

    @rsps_lib.activate
    def test_list_test_plans_returns_pydantic_model(self):
        """list_test_plans should return TestPlansListResponse."""
        _reg(rsps_lib.GET, "/1.2/projects/p1/testPlans", body={
            "items": [
                {
                    "testPlanId": "tp1",
                    "name": "Test Plan 1"
                }
            ]
        })
        api = TestPlansApi(_make_client())
        response = api.list_test_plans("p1")

        assert isinstance(response, TestPlansListResponse)


class TestFormsPydantic:
    """Verify FormsApi returns Pydantic models."""

    @rsps_lib.activate
    def test_get_project_forms_returns_pydantic_model(self):
        """get_project_forms should return FormsListResponse."""
        _reg(rsps_lib.GET, "/2.1/projects/p1/forms", body={
            "items": [
                {
                    "formId": "form1",
                    "name": "Form 1"
                }
            ]
        })
        api = FormsApi(_make_client())
        response = api.get_project_forms("p1")

        assert isinstance(response, FormsListResponse)

    @rsps_lib.activate
    def test_get_form_returns_pydantic_model(self):
        """get_form should return FormResponse."""
        _reg(rsps_lib.GET, "/1.2/projects/p1/forms/form1", body={
            "data": {
                "formId": "form1",
                "name": "Form 1"
            }
        })
        api = FormsApi(_make_client())
        response = api.get_form("p1", "form1")

        assert isinstance(response, FormResponse)


class TestInspectionPlansPydantic:
    """Verify InspectionPlansApi returns Pydantic models."""

    @rsps_lib.activate
    def test_list_inspection_plans_returns_pydantic_model(self):
        """list_inspection_plans should return InspectionPlansListResponse."""
        _reg(rsps_lib.GET, "/1.2/projects/p1/inspectionPlans", body={
            "items": [
                {
                    "inspectionPlanId": "ip1",
                    "name": "Inspection Plan 1"
                }
            ]
        })
        api = InspectionPlansApi(_make_client())
        response = api.list_inspection_plans("p1")

        assert isinstance(response, InspectionPlansListResponse)


class TestCompanyCatalogPydantic:
    """Verify CompanyCatalogApi returns Pydantic models."""

    @rsps_lib.activate
    def test_get_companies_returns_pydantic_model(self):
        """get_companies should return CompaniesListResponse."""
        _reg(rsps_lib.GET, "/2.2/companyCatalog", body={
            "items": [
                {"companyId": "c1", "name": "Company 1"}
            ]
        })
        api = CompanyCatalogApi(_make_client())
        response = api.get_companies()

        assert isinstance(response, CompaniesListResponse)

    @rsps_lib.activate
    def test_get_company_returns_pydantic_model(self):
        """get_company should return CompanyResponse."""
        _reg(rsps_lib.GET, "/1.2/companyCatalog/c1", body={
            "data": {
                "companyId": "c1",
                "name": "Company 1"
            }
        })
        api = CompanyCatalogApi(_make_client())
        response = api.get_company("c1")

        assert isinstance(response, CompanyResponse)


class TestNoneResponseHandling:
    """Verify None responses are handled correctly."""

    @rsps_lib.activate
    def test_none_response_returns_none(self):
        """When API returns no content, should return None."""
        rsps_lib.add(rsps_lib.DELETE, f"{BASE_URL}/5.0/projects/p1", status=204)
        config = Configuration(base_url=BASE_URL, api_key=API_KEY)
        client = ApiClient(config)
        result = client.delete("/5.0/projects/p1")
        assert result is None


class TestCreateClientIntegration:
    """Verify create_client works and returns Pydantic responses."""

    @rsps_lib.activate
    def test_create_client_with_env_vars(self, monkeypatch):
        """create_client should load from env vars when not provided."""
        monkeypatch.setenv("DALUX_BASE_URL", BASE_URL)
        monkeypatch.setenv("DALUX_API_KEY", API_KEY)

        _reg(rsps_lib.GET, "/5.1/projects", body={
            "items": [{"projectId": "p1", "projectName": "Project 1", "type": "Building"}]
        })

        # create_client with no args should load from env
        dalux = create_client()
        response = dalux.projects.list_projects()

        assert isinstance(response, ProjectsListResponse)
        assert len(response.items) == 1
        assert isinstance(response.items[0], Project)
