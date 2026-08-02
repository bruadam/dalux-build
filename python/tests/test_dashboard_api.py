"""Tests for resource-wide dashboard API integration."""

import pytest

from dalux_build import create_client
from dalux_build.dashboards import DashboardTemplateNotFoundError

API_NAMESPACES = (
    "projects",
    "companies",
    "company_catalog",
    "file_areas",
    "file_revisions",
    "file_upload",
    "files",
    "folders",
    "forms",
    "inspection_plans",
    "project_templates",
    "tasks",
    "test_plans",
    "users",
    "version_sets",
    "work_packages",
    "webhook_server",
)


def _client():
    return create_client(base_url="https://api.example.test", api_key="secret")


def test_every_namespace_exposes_dashboard():
    client = _client()

    for name in API_NAMESPACES:
        namespace = getattr(client, name)
        assert callable(namespace.dashboard)


def test_templates_are_scoped_to_resource():
    client = _client()

    assert [template.name for template in client.tasks.available_dashboards] == ["task-timeline"]
    assert client.files.available_dashboards == ()
    assert client.folders.available_dashboards == ()


def test_cross_resource_template_fails_before_launch():
    with pytest.raises(DashboardTemplateNotFoundError, match="resource 'files'") as error:
        _client().files.dashboard("task-timeline")

    assert "Available templates: none" in str(error.value)
