"""Tests for create_client() and all API resource classes."""
from urllib.parse import parse_qs, urlparse

import pytest
import responses as rsps_lib

from dalux_build import create_client
from dalux_build.api_client import ApiClient
from dalux_build.configuration import Configuration
from dalux_build.api import (
    CompaniesApi, CompanyCatalogApi, FileAreasApi, FileRevisionsApi,
    FileUploadApi, FilesApi, FoldersApi, FormsApi, InspectionPlansApi,
    ProjectTemplatesApi, ProjectsApi, TasksApi, TestPlansApi as DaluxTestPlansApi, UsersApi,
    VersionSetsApi, WorkPackagesApi,
)
from dalux_build.models import (
    Task,
    TaskAttachmentsListResponse,
    TaskChange,
    TaskChanges,
    TaskListParams,
    TaskResponse,
    TasksListResponse,
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


# ---------- create_client ----------

class TestCreateClient:
    def test_returns_all_namespaces(self):
        dalux = create_client(base_url=BASE_URL, api_key=API_KEY)
        assert isinstance(dalux.projects, ProjectsApi)
        assert isinstance(dalux.companies, CompaniesApi)
        assert isinstance(dalux.company_catalog, CompanyCatalogApi)
        assert isinstance(dalux.file_areas, FileAreasApi)
        assert isinstance(dalux.file_revisions, FileRevisionsApi)
        assert isinstance(dalux.file_upload, FileUploadApi)
        assert isinstance(dalux.files, FilesApi)
        assert isinstance(dalux.folders, FoldersApi)
        assert isinstance(dalux.forms, FormsApi)
        assert isinstance(dalux.inspection_plans, InspectionPlansApi)
        assert isinstance(dalux.project_templates, ProjectTemplatesApi)
        assert isinstance(dalux.tasks, TasksApi)
        assert isinstance(dalux.test_plans, DaluxTestPlansApi)
        assert isinstance(dalux.users, UsersApi)
        assert isinstance(dalux.version_sets, VersionSetsApi)
        assert isinstance(dalux.work_packages, WorkPackagesApi)


# ---------- ProjectsApi ----------

class TestProjectsApi:
    @rsps_lib.activate
    def test_list_projects(self):
        _reg(rsps_lib.GET, "/5.1/projects", body=[{"id": "p1"}])
        api = ProjectsApi(_make_client())
        result = api.list_projects()
        assert result is not None
        assert len(result.items) == 1
        assert result.items[0].project_id == "p1"

    @rsps_lib.activate
    def test_list_projects_with_params(self):
        _reg(rsps_lib.GET, "/5.1/projects", body=[])
        api = ProjectsApi(_make_client())
        api.list_projects(params={"updatedAfter": "2024-01-01"})
        assert "updatedAfter=2024-01-01" in rsps_lib.calls[0].request.url

    @rsps_lib.activate
    def test_get_project(self):
        _reg(rsps_lib.GET, "/5.0/projects/p1", body={"id": "p1"})
        api = ProjectsApi(_make_client())
        result = api.get_project("p1")
        assert result is not None
        assert result.data.project_id == "p1"

    @rsps_lib.activate
    def test_create_project(self):
        _reg(rsps_lib.POST, "/5.0/projects", body={"id": "p2"}, status=201)
        api = ProjectsApi(_make_client())
        result = api.create_project({"name": "New"})
        assert result is not None
        assert result.data.project_id == "p2"

    @rsps_lib.activate
    def test_update_project(self):
        _reg(rsps_lib.PATCH, "/5.0/projects/p1", body={"id": "p1", "name": "Updated"})
        api = ProjectsApi(_make_client())
        result = api.update_project("p1", {"name": "Updated"})
        assert result is not None
        assert result.data.project_name == "Updated"

    @rsps_lib.activate
    def test_list_metadata_mappings(self):
        _reg(rsps_lib.GET, "/1.0/projects/metadata/1.0/mappings", body=[])
        assert ProjectsApi(_make_client()).list_metadata_mappings_for_projects() == []

    @rsps_lib.activate
    def test_list_metadata_values(self):
        _reg(rsps_lib.GET, "/1.0/projects/metadata/1.0/mappings/status/values", body=[])
        assert ProjectsApi(_make_client()).list_metadata_values_for_projects("status") == []

    @rsps_lib.activate
    def test_list_project_metadata(self):
        _reg(rsps_lib.GET, "/1.0/projects/p1/metadata", body={})
        assert ProjectsApi(_make_client()).list_project_metadata("p1") == {}

    @rsps_lib.activate
    def test_list_project_metadata_mappings(self):
        _reg(rsps_lib.GET, "/1.0/projects/p1/metadata/1.0/mappings", body=[])
        assert ProjectsApi(_make_client()).list_project_metadata_mappings("p1") == []

    @rsps_lib.activate
    def test_list_project_metadata_values(self):
        _reg(rsps_lib.GET, "/1.0/projects/p1/metadata/1.0/mappings/phase/values", body=[])
        assert ProjectsApi(_make_client()).list_project_metadata_values("p1", "phase") == []


# ---------- CompaniesApi ----------

class TestCompaniesApi:
    @rsps_lib.activate
    def test_list_project_companies(self):
        _reg(rsps_lib.GET, "/3.1/projects/p1/companies", body=[])
        assert CompaniesApi(_make_client()).list_project_companies("p1") == []

    @rsps_lib.activate
    def test_get_project_company(self):
        _reg(rsps_lib.GET, "/3.0/projects/p1/companies/c1", body={"id": "c1"})
        result = CompaniesApi(_make_client()).get_project_company("p1", "c1")
        assert result is not None
        assert result.data.company_id == "c1"

    @rsps_lib.activate
    def test_create_project_company(self):
        _reg(rsps_lib.POST, "/3.1/projects/p1/companies", body={"id": "c2"}, status=201)
        result = CompaniesApi(_make_client()).create_project_company("p1", {})
        assert result is not None
        assert result.data.company_id == "c2"

    @rsps_lib.activate
    def test_update_project_company(self):
        _reg(rsps_lib.PATCH, "/3.0/projects/p1/companies/c1", body={"id": "c1"})
        result = CompaniesApi(_make_client()).update_project_company("p1", "c1", {})
        assert result is not None
        assert result.data.company_id == "c1"


# ---------- CompanyCatalogApi ----------

class TestCompanyCatalogApi:
    @rsps_lib.activate
    def test_get_companies(self):
        _reg(rsps_lib.GET, "/2.2/companyCatalog", body=[])
        assert CompanyCatalogApi(_make_client()).get_companies() == []

    @rsps_lib.activate
    def test_get_company(self):
        _reg(rsps_lib.GET, "/1.2/companyCatalog/cc1", body={"id": "cc1"})
        result = CompanyCatalogApi(_make_client()).get_company("cc1")
        assert result is not None
        assert result.data.company_id == "cc1"

    @rsps_lib.activate
    def test_create_company(self):
        _reg(rsps_lib.POST, "/2.2/companyCatalog", body={"id": "cc2"}, status=201)
        result = CompanyCatalogApi(_make_client()).create_company({})
        assert result is not None
        assert result.data.company_id == "cc2"

    @rsps_lib.activate
    def test_update_company(self):
        _reg(rsps_lib.PATCH, "/2.1/companyCatalog/cc1", body={"id": "cc1"})
        result = CompanyCatalogApi(_make_client()).update_company("cc1", {})
        assert result is not None
        assert result.data.company_id == "cc1"

    @rsps_lib.activate
    def test_list_company_metadata(self):
        _reg(rsps_lib.GET, "/1.0/companyCatalog/cc1/metadata", body={})
        assert CompanyCatalogApi(_make_client()).list_company_metadata("cc1") == {}

    @rsps_lib.activate
    def test_list_company_metadata_mappings(self):
        _reg(rsps_lib.GET, "/1.0/companyCatalog/cc1/metadata/1.0/mappings", body=[])
        assert CompanyCatalogApi(_make_client()).list_company_metadata_mappings("cc1") == []

    @rsps_lib.activate
    def test_list_company_metadata_values(self):
        _reg(rsps_lib.GET, "/1.0/companyCatalog/cc1/metadata/1.0/mappings/industry/values", body=[])
        assert CompanyCatalogApi(_make_client()).list_company_metadata_values("cc1", "industry") == []

    @rsps_lib.activate
    def test_list_metadata_mappings_for_companies(self):
        _reg(rsps_lib.GET, "/1.0/companyCatalog/metadata/1.0/mappings", body=[])
        assert CompanyCatalogApi(_make_client()).list_metadata_mappings_for_companies() == []

    @rsps_lib.activate
    def test_list_metadata_values_for_companies(self):
        _reg(rsps_lib.GET, "/1.0/companyCatalog/metadata/1.0/mappings/country/values", body=[])
        assert CompanyCatalogApi(_make_client()).list_metadata_values_for_companies("country") == []


# ---------- TasksApi ----------

class TestTasksApi:
    @rsps_lib.activate
    def test_get_project_tasks(self):
        _reg(rsps_lib.GET, "/5.2/projects/p1/tasks", body=[])
        response = TasksApi(_make_client()).get_project_tasks("p1")
        assert isinstance(response, TasksListResponse)
        assert response.items == []

    @rsps_lib.activate
    def test_get_project_tasks_maps_type_id_to_odata_filter(self):
        _reg(rsps_lib.GET, "/5.2/projects/p1/tasks", body=[])
        TasksApi(_make_client()).get_project_tasks(
            "p1",
            params={"typeId": "177352982697"},
        )
        query = parse_qs(urlparse(rsps_lib.calls[0].request.url).query)
        assert query == {"$filter": ["data/type/typeId eq '177352982697'"]}

    @rsps_lib.activate
    def test_get_project_tasks_type_id_maps_to_odata_path_for_snowflake_ids(self):
        _reg(rsps_lib.GET, "/5.2/projects/p1/tasks", body=[])
        TasksApi(_make_client()).get_project_tasks(
            "p1",
            params={"typeId": "S410425647911927812"},
        )
        query = parse_qs(urlparse(rsps_lib.calls[0].request.url).query)
        assert query == {"$filter": ["data/type/typeId eq 'S410425647911927812'"]}

    @rsps_lib.activate
    def test_get_project_tasks_type_id_escapes_single_quotes_in_odata_filter(self):
        _reg(rsps_lib.GET, "/5.2/projects/p1/tasks", body=[])
        TasksApi(_make_client()).get_project_tasks(
            "p1",
            params={"typeId": "x'y"},
        )
        query = parse_qs(urlparse(rsps_lib.calls[0].request.url).query)
        assert query == {"$filter": ["data/type/typeId eq 'x''y'"]}

    @rsps_lib.activate
    def test_get_project_tasks_accepts_task_list_params_model(self):
        _reg(rsps_lib.GET, "/5.2/projects/p1/tasks", body=[])
        TasksApi(_make_client()).get_project_tasks(
            "p1",
            params=TaskListParams(type_id="S410425647911927812"),
        )
        query = parse_qs(urlparse(rsps_lib.calls[0].request.url).query)
        assert query == {"$filter": ["data/type/typeId eq 'S410425647911927812'"]}

    @rsps_lib.activate
    def test_get_all_project_tasks_follows_pagination(self):
        page1 = {
            "items": [{"data": {"taskId": "t1"}}],
            "metadata": {"totalItems": 2, "totalRemainingItems": 1},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=bm1", "method": "GET"}
            ],
        }
        page2 = {
            "items": [{"data": {"taskId": "t2"}}],
            "metadata": {"totalItems": 2, "totalRemainingItems": 0},
            "links": [],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page2, status=200)
        result = TasksApi(_make_client()).get_all_project_tasks("p1")
        assert len(result) == 2
        assert isinstance(result[0], Task)
        assert result[0].task_id == "t1"
        assert result[1].task_id == "t2"

    @rsps_lib.activate
    def test_get_all_project_tasks_stops_when_total_remaining_zero_ignores_next_link(self):
        """Same idea as get_all_files: remaining=0 ends pagination even if nextPage exists."""
        page1 = {
            "items": [{"data": {"taskId": "t1"}}],
            "metadata": {"totalRemainingItems": 1},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=bm1", "method": "GET"}
            ],
        }
        page2 = {
            "items": [{"data": {"taskId": "t2"}}],
            "metadata": {"totalRemainingItems": 0},
            "links": [
                {
                    "rel": "nextPage",
                    "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=should-not-be-called",
                    "method": "GET",
                }
            ],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page2, status=200)
        result = TasksApi(_make_client()).get_all_project_tasks("p1")
        assert len(result) == 2
        assert all(isinstance(item, Task) for item in result)
        assert len(rsps_lib.calls) == 2

    @rsps_lib.activate
    def test_get_all_project_tasks_verbose_matches_files_when_total_remaining(self, capsys):
        page1 = {
            "items": [{"data": {"taskId": "t1"}}],
            "metadata": {"totalRemainingItems": 1},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=bm1", "method": "GET"}
            ],
        }
        page2 = {
            "items": [{"data": {"taskId": "t2"}}],
            "metadata": {"totalRemainingItems": 0},
            "links": [],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page2, status=200)
        TasksApi(_make_client()).get_all_project_tasks("p1", verbose=True)
        out = capsys.readouterr().out
        assert "Retrieved 1 tasks so far, 1 remaining..." in out
        assert "Retrieved 2 tasks so far, 0 remaining..." in out
        assert "Done. Total tasks retrieved: 2" in out

    @rsps_lib.activate
    def test_get_all_project_tasks_verbose_uses_total_items_when_no_total_remaining(
        self, capsys
    ):
        """Tasks list may only return totalItems; last page may report 0."""
        page1 = {
            "items": [{"data": {"taskId": "t1"}}],
            "metadata": {"totalItems": 2},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=bm1", "method": "GET"}
            ],
        }
        page2 = {
            "items": [{"data": {"taskId": "t2"}}],
            "metadata": {"totalItems": 0},
            "links": [],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page2, status=200)
        TasksApi(_make_client()).get_all_project_tasks("p1", verbose=True)
        out = capsys.readouterr().out
        assert "Retrieved 1 tasks so far, 1 remaining..." in out
        assert "Retrieved 2 tasks so far, 0 remaining..." in out
        assert "Done. Total tasks retrieved: 2" in out

    @rsps_lib.activate
    def test_get_all_project_tasks_total_items_ceiling_stops_when_metadata_stuck(self):
        """totalItems can stay >0 with nextPage; max(totalItems) caps rows (Dalux quirk)."""
        page1 = {
            "items": [{"data": {"taskId": "a"}}],
            "metadata": {"totalItems": 3},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=b1", "method": "GET"}
            ],
        }
        page2 = {
            "items": [{"data": {"taskId": "b"}}],
            "metadata": {"totalItems": 2},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=b2", "method": "GET"}
            ],
        }
        page3 = {
            "items": [{"data": {"taskId": "c"}}],
            "metadata": {"totalItems": 1},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=b3", "method": "GET"}
            ],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page2, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page3, status=200)
        result = TasksApi(_make_client()).get_all_project_tasks("p1")
        assert [x.task_id for x in result] == ["a", "b", "c"]
        assert len(rsps_lib.calls) == 3

    @rsps_lib.activate
    def test_get_all_project_tasks_keeps_type_id_filter_during_pagination(self):
        page1 = {
            "items": [{"data": {"taskId": "t1"}}],
            "metadata": {"totalRemainingItems": 1},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/5.2/projects/p1/tasks?bookmark=bm1", "method": "GET"}
            ],
        }
        page2 = {
            "items": [{"data": {"taskId": "t2"}}],
            "metadata": {"totalRemainingItems": 0},
            "links": [],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/5.2/projects/p1/tasks", json=page2, status=200)
        TasksApi(_make_client()).get_all_project_tasks(
            "p1",
            params={"typeId": "177352982697"},
        )
        first_query = parse_qs(urlparse(rsps_lib.calls[0].request.url).query)
        second_query = parse_qs(urlparse(rsps_lib.calls[1].request.url).query)
        assert first_query == {"$filter": ["data/type/typeId eq '177352982697'"]}
        assert second_query == {
            "$filter": ["data/type/typeId eq '177352982697'"],
            "bookmark": ["bm1"],
        }

    @rsps_lib.activate
    def test_get_task(self):
        _reg(rsps_lib.GET, "/3.3/projects/p1/tasks/t1", body={"id": "t1"})
        result = TasksApi(_make_client()).get_task("p1", "t1")
        assert result is not None
        assert isinstance(result, TaskResponse)
        assert result.data.task_id == "t1"

    @rsps_lib.activate
    def test_get_project_task_changes(self):
        _reg(
            rsps_lib.GET,
            "/2.2/projects/p1/tasks/changes",
            body=[
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
            ],
        )
        response = TasksApi(_make_client()).get_project_task_changes("p1")
        assert isinstance(response, TaskChanges)
        assert len(response.items) == 1
        assert response.items[0].task_id == "S339368766909448192"
        assert response.items[0].action == "reject"

    @rsps_lib.activate
    def test_get_all_project_task_changes_follows_pagination(self):
        page1 = {
            "items": [{"taskId": "t1", "timestamp": "2025-08-05T07:55:56.9900000+00:00", "action": "create", "fields": {}}],
            "metadata": {"totalItems": 2, "totalRemainingItems": 1},
            "links": [
                {"rel": "nextPage", "href": f"{BASE_URL}/2.2/projects/p1/tasks/changes?bookmark=bm1", "method": "GET"}
            ],
        }
        page2 = {
            "items": [{"taskId": "t2", "timestamp": "2025-08-05T08:55:56.9900000+00:00", "action": "reject", "fields": {}}],
            "metadata": {"totalItems": 2, "totalRemainingItems": 0},
            "links": [],
        }
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/2.2/projects/p1/tasks/changes", json=page1, status=200)
        rsps_lib.add(rsps_lib.GET, f"{BASE_URL}/2.2/projects/p1/tasks/changes", json=page2, status=200)
        result = TasksApi(_make_client()).get_all_project_task_changes("p1")
        assert len(result) == 2
        assert all(isinstance(item, TaskChange) for item in result)
        assert result[0].task_id == "t1"
        assert result[1].task_id == "t2"

    @rsps_lib.activate
    def test_get_project_task_attachments(self):
        _reg(rsps_lib.GET, "/1.1/projects/p1/tasks/attachments", body=[])
        response = TasksApi(_make_client()).get_project_task_attachments("p1")
        assert isinstance(response, TaskAttachmentsListResponse)
        assert response.items == []


# ---------- FileAreasApi ----------

class TestFileAreasApi:
    @rsps_lib.activate
    def test_get_file_areas(self):
        _reg(rsps_lib.GET, "/5.1/projects/p1/file_areas", body={"items": []})
        response = FileAreasApi(_make_client()).get_file_areas("p1")
        assert response is not None
        assert response.items == []

    @rsps_lib.activate
    def test_get_file_area(self):
        _reg(rsps_lib.GET, "/1.0/projects/p1/file_areas/fa1", body={
            "fileAreaId": "fa1",
            "fileAreaName": "Main",
            "fileAreaType": "Drawings",
        })
        response = FileAreasApi(_make_client()).get_file_area("p1", "fa1")
        assert response is not None
        assert response.file_area_id == "fa1"
        assert response.file_area_name == "Main"


# ---------- FilesApi ----------

class TestFilesApi:
    @rsps_lib.activate
    def test_list_files(self):
        _reg(rsps_lib.GET, "/6.1/projects/p1/file_areas/fa1/files", body={"items": []})
        result = FilesApi(_make_client()).list_files("p1", "fa1")
        assert result is not None
        assert result.items == []

    @rsps_lib.activate
    def test_get_file(self):
        _reg(rsps_lib.GET, "/5.0/projects/p1/file_areas/fa1/files/f1", body={"data": {
            "fileId": "f1", 
            "fileName": "test.txt", 
            "fileAreaId": "fa1", 
            "fileType": "document"
        }})
        result = FilesApi(_make_client()).get_file("p1", "fa1", "f1")
        assert result is not None
        assert result.data.file_id == "f1"
        assert result.data.file_name == "test.txt"

    @rsps_lib.activate
    def test_get_file_properties_mapping(self):
        _reg(rsps_lib.GET, "/1.0/projects/p1/file_areas/fa1/files/f1/properties/1.0/mappings", body=[])
        assert FilesApi(_make_client()).get_file_properties_mapping("p1", "fa1", "f1") == []

    @rsps_lib.activate
    def test_get_file_property_mapping_values(self):
        _reg(rsps_lib.GET, "/1.0/projects/p1/file_areas/fa1/files/properties/1.0/mappings/prop1/values", body=[])
        assert FilesApi(_make_client()).get_file_property_mapping_values("p1", "fa1", "prop1") == []


# ---------- FoldersApi ----------

class TestFoldersApi:
    @rsps_lib.activate
    def test_list_folders(self):
        _reg(rsps_lib.GET, "/5.1/projects/p1/file_areas/fa1/folders", body={"items": []})
        result = FoldersApi(_make_client()).list_folders("p1", "fa1")
        assert result is not None
        assert result.items == []

    @rsps_lib.activate
    def test_get_folder(self):
        _reg(rsps_lib.GET, "/5.0/projects/p1/file_areas/fa1/folders/fo1", body={"data": {"folderId": "fo1", "folderName": "Test Folder"}})
        result = FoldersApi(_make_client()).get_folder("p1", "fa1", "fo1")
        assert result is not None
        assert result.data.folder_id == "fo1"
        assert result.data.folder_name == "Test Folder"

    @rsps_lib.activate
    def test_get_folder_files_properties(self):
        _reg(rsps_lib.GET, "/1.0/projects/p1/file_areas/fa1/folders/fo1/files/properties/1.0/mappings", body=[])
        assert FoldersApi(_make_client()).get_folder_files_properties("p1", "fa1", "fo1") == []

    @rsps_lib.activate
    def test_get_folder_by_name(self):
        # Mock the list folders endpoint to return a folder with the name we're looking for
        _reg(rsps_lib.GET, "/5.1/projects/p1/file_areas/fa1/folders", body={
            "items": [
                {"data": {"folderId": "fo1", "folderName": "Test Folder", "parentFolderId": None}},
                {"data": {"folderId": "fo2", "folderName": "Other Folder", "parentFolderId": None}}
            ]
        })
        
        api = FoldersApi(_make_client())
        result = api.get_folder_by_name("p1", "fa1", "Test Folder")
        
        assert result is not None
        assert result.data.folder_id == "fo1"
        assert result.data.folder_name == "Test Folder"

    @rsps_lib.activate
    def test_get_folder_by_name_not_found(self):
        # Mock the list folders endpoint to return folders that don't match
        _reg(rsps_lib.GET, "/5.1/projects/p1/file_areas/fa1/folders", body={
            "items": [
                {"data": {"folderId": "fo1", "folderName": "Other Folder", "parentFolderId": None}}
            ]
        })
        
        api = FoldersApi(_make_client())
        result = api.get_folder_by_name("p1", "fa1", "Non Existent Folder")
        
        assert result is None


# ---------- FileUploadApi ----------

class TestFileUploadApi:
    @rsps_lib.activate
    def test_create_upload(self):
        _reg(rsps_lib.POST, "/1.0/projects/p1/file_areas/fa1/upload", body={"uploadGuid": "g1"})
        assert FileUploadApi(_make_client()).create_upload("p1", "fa1", {}) == {"uploadGuid": "g1"}

    @rsps_lib.activate
    def test_upload_file_part(self):
        _reg(rsps_lib.POST, "/1.0/projects/p1/file_areas/fa1/upload/g1", body={})
        assert FileUploadApi(_make_client()).upload_file_part("p1", "fa1", "g1", b"data") == {}

    @rsps_lib.activate
    def test_finish_upload(self):
        _reg(rsps_lib.POST, "/2.0/projects/p1/file_areas/fa1/upload/g1/finalize", body={"fileId": "fn"})
        assert FileUploadApi(_make_client()).finish_upload("p1", "fa1", "g1", {}) == {"fileId": "fn"}


# ---------- FileRevisionsApi ----------

class TestFileRevisionsApi:
    @rsps_lib.activate
    def test_get_file_revision_content(self):
        _reg(rsps_lib.GET, "/2.0/projects/p1/file_areas/fa1/files/f1/revisions/r1/content", body={})
        result = FileRevisionsApi(_make_client()).get_file_revision_content("p1", "fa1", "f1", "r1")
        assert result is not None


# ---------- FormsApi ----------

class TestFormsApi:
    @rsps_lib.activate
    def test_get_project_forms(self):
        _reg(rsps_lib.GET, "/2.1/projects/p1/forms", body=[])
        assert FormsApi(_make_client()).get_project_forms("p1") == []

    @rsps_lib.activate
    def test_get_form(self):
        _reg(rsps_lib.GET, "/1.2/projects/p1/forms/fm1", body={"id": "fm1"})
        result = FormsApi(_make_client()).get_form("p1", "fm1")
        assert result is not None
        assert result.data["formId"] == "fm1"

    @rsps_lib.activate
    def test_get_project_form_attachments(self):
        _reg(rsps_lib.GET, "/2.1/projects/p1/forms/attachments", body=[])
        assert FormsApi(_make_client()).get_project_form_attachments("p1") == []


# ---------- UsersApi ----------

class TestUsersApi:
    @rsps_lib.activate
    def test_get_user(self):
        _reg(rsps_lib.GET, "/1.1/users/u1", body={"id": "u1"})
        result = UsersApi(_make_client()).get_user("u1")
        assert result is not None
        assert result.data.user_id == "u1"

    @rsps_lib.activate
    def test_list_project_users(self):
        _reg(rsps_lib.GET, "/1.2/projects/p1/users", body=[])
        assert UsersApi(_make_client()).list_project_users("p1") == []

    @rsps_lib.activate
    def test_get_project_user(self):
        _reg(rsps_lib.GET, "/1.1/projects/p1/users/u1", body={"id": "u1"})
        assert UsersApi(_make_client()).get_project_user("p1", "u1") == {"id": "u1"}


# ---------- ProjectTemplatesApi ----------

class TestProjectTemplatesApi:
    @rsps_lib.activate
    def test_list_project_templates(self):
        _reg(rsps_lib.GET, "/1.1/projectTemplates", body=[])
        assert ProjectTemplatesApi(_make_client()).list_project_templates() == []


# ---------- InspectionPlansApi ----------

class TestInspectionPlansApi:
    @rsps_lib.activate
    def test_list_inspection_plans(self):
        _reg(rsps_lib.GET, "/1.2/projects/p1/inspectionPlans", body=[])
        assert InspectionPlansApi(_make_client()).list_inspection_plans("p1") == []

    @rsps_lib.activate
    def test_list_inspection_plan_items(self):
        _reg(rsps_lib.GET, "/1.1/projects/p1/inspectionPlanItems", body=[])
        assert InspectionPlansApi(_make_client()).list_inspection_plan_items("p1") == []

    @rsps_lib.activate
    def test_list_inspection_plan_item_zones(self):
        _reg(rsps_lib.GET, "/1.1/projects/p1/inspectionPlanItemZones", body=[])
        assert InspectionPlansApi(_make_client()).list_inspection_plan_item_zones("p1") == []

    @rsps_lib.activate
    def test_list_inspection_plan_registrations(self):
        _reg(rsps_lib.GET, "/2.1/projects/p1/inspectionPlanRegistrations", body=[])
        assert InspectionPlansApi(_make_client()).list_inspection_plan_registrations("p1") == []


# ---------- TestPlansApi ----------

class TestTestPlansApi:
    @rsps_lib.activate
    def test_list_test_plans(self):
        _reg(rsps_lib.GET, "/1.2/projects/p1/testPlans", body=[])
        assert DaluxTestPlansApi(_make_client()).list_test_plans("p1") == []

    @rsps_lib.activate
    def test_list_test_plan_items(self):
        _reg(rsps_lib.GET, "/1.1/projects/p1/testPlanItems", body=[])
        assert DaluxTestPlansApi(_make_client()).list_test_plan_items("p1") == []

    @rsps_lib.activate
    def test_list_test_plan_item_zones(self):
        _reg(rsps_lib.GET, "/1.1/projects/p1/testPlanItemZones", body=[])
        assert DaluxTestPlansApi(_make_client()).list_test_plan_item_zones("p1") == []

    @rsps_lib.activate
    def test_list_test_plan_registrations(self):
        _reg(rsps_lib.GET, "/1.1/projects/p1/testPlanRegistrations", body=[])
        assert DaluxTestPlansApi(_make_client()).list_test_plan_registrations("p1") == []


# ---------- VersionSetsApi ----------

class TestVersionSetsApi:
    @rsps_lib.activate
    def test_get_version_sets(self):
        _reg(rsps_lib.GET, "/2.1/projects/p1/version_sets", body=[])
        assert VersionSetsApi(_make_client()).get_version_sets("p1") == []

    @rsps_lib.activate
    def test_get_version_set(self):
        _reg(rsps_lib.GET, "/2.0/projects/p1/version_sets/vs1", body={"id": "vs1"})
        result = VersionSetsApi(_make_client()).get_version_set("p1", "vs1")
        assert result is not None
        assert result.data.version_set_id == "vs1"

    @rsps_lib.activate
    def test_list_file_area_version_sets(self):
        _reg(rsps_lib.GET, "/2.1/projects/p1/file_areas/fa1/version_sets", body=[])
        assert VersionSetsApi(_make_client()).list_file_area_version_sets("p1", "fa1") == []

    @rsps_lib.activate
    def test_list_version_set_files(self):
        _reg(rsps_lib.GET, "/3.0/projects/p1/version_sets/vs1/files", body=[])
        assert VersionSetsApi(_make_client()).list_version_set_files("p1", "vs1") == []


# ---------- WorkPackagesApi ----------

class TestWorkPackagesApi:
    @rsps_lib.activate
    def test_list_work_packages(self):
        _reg(
            rsps_lib.GET,
            "/1.0/projects/p1/workpackages",
            body={"items": [{"workpackageId": "wp1", "companyId": "c1", "name": "Facade"}]},
        )
        result = WorkPackagesApi(_make_client()).list_work_packages("p1")
        assert result is not None
        assert len(result.items) == 1
        assert result.items[0].workpackage_id == "wp1"
        assert result.items[0].name == "Facade"
