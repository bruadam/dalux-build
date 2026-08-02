"""Task lifecycle timeline dashboard template."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import TYPE_CHECKING, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ...json_types import JSONDict, JSONValue, QueryParams
from ...models import Task, TaskChange, TaskChangeActor

if TYPE_CHECKING:
    import plotly.graph_objects as go

    from ... import DaluxClient


@dataclass(frozen=True)
class LifecycleEvent:
    """One displayable event in a task lifecycle."""

    timestamp: datetime
    action: str
    description: str | None = None
    status: str | None = None
    assignee: str | None = None


@dataclass(frozen=True)
class TaskTimelineRecord:
    """Normalized task and its ordered lifecycle events."""

    task_id: str
    label: str
    title: str | None
    created: datetime
    deadline: datetime | None
    status: str | None
    assignee: str | None
    events: tuple[LifecycleEvent, ...]


def _task_payload(task: Task) -> JSONDict:
    return cast(JSONDict, task.model_dump(mode="json", by_alias=True, exclude_none=True))


def _text(payload: JSONDict, key: str) -> str | None:
    value = payload.get(key)
    if value is None or isinstance(value, (dict, list)):
        return None
    text_value = str(value).strip()
    return text_value or None


def _parse_datetime(value: JSONValue | date | datetime) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def _actor_label(actor: TaskChangeActor | None) -> str | None:
    if actor is None:
        return None
    return actor.name or actor.user_name or actor.role_name or actor.user_id or actor.role_id


def build_timeline_records(
    tasks: list[Task], changes: list[TaskChange]
) -> list[TaskTimelineRecord]:
    """Normalize tasks and task changes into chronologically sorted records."""
    changes_by_task: dict[str, list[TaskChange]] = {}
    for change in changes:
        changes_by_task.setdefault(change.task_id, []).append(change)
    for task_changes in changes_by_task.values():
        task_changes.sort(key=lambda item: item.timestamp)

    records: list[TaskTimelineRecord] = []
    for task in tasks:
        if not task.task_id:
            continue
        payload = _task_payload(task)
        task_changes = changes_by_task.get(task.task_id, [])
        created = _parse_datetime(payload.get("created"))
        if created is None and task_changes:
            created = task_changes[0].timestamp
        if created is None:
            continue

        title = _text(payload, "title")
        number = _text(payload, "number")
        status = _text(payload, "status")
        deadline = _parse_datetime(payload.get("deadline"))
        assignee: str | None = None
        events = [LifecycleEvent(timestamp=created, action="created", description=title)]

        for change in task_changes:
            fields = change.fields
            change_status = fields.status if fields else None
            change_assignee = _actor_label(
                (fields.current_responsible or fields.assigned_to) if fields else None
            )
            change_deadline = _parse_datetime(fields.deadline) if fields else None
            if change_status:
                status = change_status
            if change_assignee:
                assignee = change_assignee
            if change_deadline:
                deadline = change_deadline
            events.append(
                LifecycleEvent(
                    timestamp=change.timestamp,
                    action=change.action.lower() or "other",
                    description=change.description,
                    status=change_status,
                    assignee=change_assignee,
                )
            )

        records.append(
            TaskTimelineRecord(
                task_id=task.task_id,
                label=number or task.task_id,
                title=title,
                created=created,
                deadline=deadline,
                status=status,
                assignee=assignee,
                events=tuple(sorted(events, key=lambda event: event.timestamp)),
            )
        )

    return sorted(records, key=lambda record: (record.created, record.label), reverse=True)


def _local_datetime(value: datetime, target_timezone: ZoneInfo) -> datetime:
    aware_value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware_value.astimezone(target_timezone)


def build_figure(records: list[TaskTimelineRecord], timezone_name: str) -> go.Figure:
    """Build a responsive Plotly lifecycle figure."""
    import plotly.graph_objects as go

    try:
        target_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timezone: {timezone_name}") from exc

    figure = go.Figure()
    for record in reversed(records):
        timestamps = [_local_datetime(event.timestamp, target_timezone) for event in record.events]
        hover = [
            "<br>".join(
                part
                for part in (
                    f"{record.label}: {event.action.title()}",
                    event.description,
                    f"Status: {event.status}" if event.status else None,
                    f"Assignee: {event.assignee}" if event.assignee else None,
                )
                if part
            )
            for event in record.events
        ]
        figure.add_trace(
            go.Scatter(
                x=timestamps,
                y=[record.label] * len(timestamps),
                mode="lines+markers",
                name=record.label,
                text=hover,
                hovertemplate="%{text}<br>%{x|%Y-%m-%d %H:%M}<extra></extra>",
                line={"color": "#64748b", "width": 2},
                marker={"size": 9, "color": "#0f766e"},
                showlegend=False,
            )
        )
        if record.deadline:
            figure.add_trace(
                go.Scatter(
                    x=[_local_datetime(record.deadline, target_timezone)],
                    y=[record.label],
                    mode="markers",
                    text=[f"{record.label}: Deadline"],
                    hovertemplate="%{text}<br>%{x|%Y-%m-%d}<extra></extra>",
                    marker={"symbol": "diamond-open", "size": 11, "color": "#d97706"},
                    showlegend=False,
                )
            )

    figure.update_layout(
        template="plotly_white",
        height=max(480, min(1400, 34 * len(records) + 180)),
        margin={"l": 80, "r": 24, "t": 24, "b": 48},
        hovermode="closest",
        xaxis_title=f"Lifecycle time ({timezone_name})",
        yaxis_title="Task",
    )
    figure.update_xaxes(rangeslider={"visible": True, "thickness": 0.06})
    return figure


def _query_params(options: JSONDict) -> QueryParams | None:
    value = options.get("task_params")
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("template_options.task_params must be an object")
    return cast(QueryParams, value)


def filter_timeline_records(
    records: list[TaskTimelineRecord],
    *,
    task_ids: list[str],
    statuses: list[str],
    actions: list[str],
    search: str,
) -> list[TaskTimelineRecord]:
    """Filter timeline records using the dashboard sidebar selections."""
    normalized_search = search.strip().lower()
    return [
        record
        for record in records
        if (not task_ids or record.task_id in task_ids)
        and (not statuses or record.status in statuses)
        and (not actions or any(event.action in actions for event in record.events))
        and (
            not normalized_search
            or normalized_search in record.label.lower()
            or normalized_search in (record.title or "").lower()
            or normalized_search in record.task_id.lower()
        )
    ]


def render(client: DaluxClient, options: JSONDict) -> None:
    """Render the task timeline Streamlit application."""
    import streamlit as st

    supported_options = {
        "project_id",
        "task_params",
        "timezone",
        "title",
        "cache_ttl",
        "task_link_format",
    }
    unsupported = sorted(set(options) - supported_options)
    if unsupported:
        raise ValueError(f"Unsupported task-timeline options: {', '.join(unsupported)}")

    project_id_value = options.get("project_id")
    project_id = str(project_id_value) if project_id_value else None
    title_value = options.get("title")
    title = str(title_value) if title_value else "Dalux task timeline"
    timezone_value = options.get("timezone")
    timezone_name = str(timezone_value) if timezone_value else "UTC"

    st.set_page_config(page_title=title, layout="wide")
    st.title(title)
    tasks = client.tasks.get_all_project_tasks(params=_query_params(options), project_id=project_id)
    changes = client.tasks.get_all_project_task_changes(project_id=project_id)
    records = build_timeline_records(tasks, changes)
    if not records:
        st.info("No tasks with lifecycle timestamps matched this dashboard.")
        return

    status_values = sorted({record.status for record in records if record.status})
    action_values = sorted({event.action for record in records for event in record.events})
    task_names = {record.task_id: record.label for record in records}
    selected_task_ids = st.sidebar.multiselect(
        "Task ID",
        sorted(task_names, key=lambda task_id: task_names[task_id]),
        format_func=task_names.__getitem__,
    )
    selected_statuses = st.sidebar.multiselect("Status", status_values)
    selected_actions = st.sidebar.multiselect("Lifecycle event", action_values)
    search = st.sidebar.text_input("Search tasks")

    filtered = filter_timeline_records(
        records,
        task_ids=selected_task_ids,
        statuses=selected_statuses,
        actions=selected_actions,
        search=search,
    )

    metric_columns = st.columns(3)
    metric_columns[0].metric("Tasks", len(filtered))
    metric_columns[1].metric("With deadline", sum(item.deadline is not None for item in filtered))
    metric_columns[2].metric("Lifecycle events", sum(len(item.events) for item in filtered))
    if not filtered:
        st.info("No tasks matched the selected filters.")
        return

    st.plotly_chart(build_figure(filtered, timezone_name), use_container_width=True)
    st.dataframe(
        [
            {
                "Task": record.label,
                "Title": record.title,
                "Status": record.status,
                "Assignee": record.assignee,
                "Created": record.created,
                "Deadline": record.deadline,
                "Events": len(record.events),
                "Task ID": record.task_id,
            }
            for record in filtered
        ],
        use_container_width=True,
        hide_index=True,
    )
