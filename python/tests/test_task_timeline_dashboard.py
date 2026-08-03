"""Tests for the task timeline dashboard template."""

from datetime import datetime, timezone

from dalux_build.dashboards.templates.task_timeline import (
    build_timeline_records,
    filter_timeline_records,
)
from dalux_build.models import Task, TaskChange


def test_build_records_uses_earliest_change_when_created_is_missing():
    task = Task.model_validate({"taskId": "t1", "number": "TASK-1", "title": "Inspect slab"})
    changes = [
        TaskChange.model_validate(
            {
                "taskId": "t1",
                "timestamp": "2026-01-02T08:00:00Z",
                "action": "assign",
                "fields": {
                    "status": "Open",
                    "currentResponsible": {"userName": "Ada"},
                },
            }
        ),
        TaskChange.model_validate(
            {
                "taskId": "t1",
                "timestamp": "2026-01-04T08:00:00Z",
                "action": "customAction",
                "fields": {"deadline": "2026-01-10", "status": "In progress"},
            }
        ),
    ]

    records = build_timeline_records([task], list(reversed(changes)))

    assert len(records) == 1
    record = records[0]
    assert record.label == "TASK-1"
    assert record.created == datetime(2026, 1, 2, 8, tzinfo=timezone.utc)
    assert record.status == "In progress"
    assert record.assignee == "Ada"
    assert record.deadline is not None
    assert [event.action for event in record.events] == [
        "created",
        "assign",
        "customaction",
    ]


def test_build_records_keeps_task_without_changes_when_created_exists():
    task = Task.model_validate(
        {"taskId": "t2", "created": "2026-02-01T10:00:00Z", "title": "Review"}
    )

    records = build_timeline_records([task], [])

    assert len(records) == 1
    assert records[0].label == "t2"
    assert [event.action for event in records[0].events] == ["created"]


def test_build_records_omits_task_without_any_timestamp():
    task = Task.model_validate({"taskId": "t3", "title": "Unknown date"})

    assert build_timeline_records([task], []) == []


def test_filter_records_selects_exact_task_id():
    tasks = [
        Task.model_validate(
            {"taskId": "t1", "number": "TASK-1", "created": "2026-02-01T10:00:00Z"}
        ),
        Task.model_validate(
            {"taskId": "t2", "number": "TASK-2", "created": "2026-02-02T10:00:00Z"}
        ),
    ]
    records = build_timeline_records(tasks, [])

    filtered = filter_timeline_records(
        records,
        task_ids=["t2"],
        statuses=[],
        actions=[],
        search="",
        assignees=[],
        companies=[],
    )

    assert [record.label for record in filtered] == ["TASK-2"]
