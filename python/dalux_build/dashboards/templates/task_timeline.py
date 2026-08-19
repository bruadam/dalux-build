"""Task lifecycle timeline dashboard template."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import TYPE_CHECKING, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ...json_types import JSONDict, JSONValue, QueryParams
from ...models import ProjectCompany, ProjectUser, Task, TaskChange, TaskChangeActor

try:
    import holidays

    HOLIDAYS_AVAILABLE = True
except ImportError:
    HOLIDAYS_AVAILABLE = False

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
    company_id: str | None
    company_name: str | None
    events: tuple[LifecycleEvent, ...]


@dataclass(frozen=True)
class TaskTransition:
    """Represents a transition between assign and completion events."""

    task_id: str
    label: str
    assign_timestamp: datetime
    complete_timestamp: datetime
    assign_action: str
    complete_action: str
    assigned_to: str | None
    assigned_to_company: str | None
    completed_by: str | None
    completed_by_company: str | None
    business_days: int


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


def _actor_label(
    actor: TaskChangeActor | None,
    user_id_to_name: dict[str, str] | None = None,
) -> str | None:
    if actor is None:
        return None
    if actor.name:
        return actor.name
    if actor.user_name:
        return actor.user_name
    if actor.user_id and user_id_to_name:
        return user_id_to_name.get(actor.user_id, actor.user_id)
    return actor.role_name or actor.user_id or actor.role_id


def _get_actor_company(
    actor: TaskChangeActor | None,
    user_company_map: dict[str, tuple[str, str]] | None = None,
    company_name_map: dict[str, str] | None = None,
) -> tuple[str | None, str | None]:
    """Get company_id and company_name for an actor."""
    if actor is None:
        return None, None
    user_id = actor.user_id
    if user_id and user_company_map:
        company_id, _ = user_company_map.get(user_id, (None, None))
        if company_id and company_name_map:
            company_name = company_name_map.get(company_id, company_id)
            return company_id, company_name
    return None, None


def _build_user_name_map(users: list[ProjectUser]) -> dict[str, str]:
    """Build a mapping from user_id to user's full name."""
    user_map: dict[str, str] = {}
    for user in users:
        if user.user_id:
            name_parts = []
            if user.first_name:
                name_parts.append(user.first_name)
            if user.last_name:
                name_parts.append(user.last_name)
            full_name = " ".join(name_parts) if name_parts else user.email
            user_map[user.user_id] = full_name
    return user_map


def _build_user_company_map(users: list[ProjectUser]) -> dict[str, tuple[str, str]]:
    """Build a mapping from user_id to (company_id, company_name)."""
    user_company_map: dict[str, tuple[str, str]] = {}
    for user in users:
        if user.user_id:
            company_id = user.company_id or ""
            company_name = ""
            user_company_map[user.user_id] = (company_id, company_name)
    return user_company_map


def _build_company_name_map(companies: list[ProjectCompany]) -> dict[str, str]:
    """Build a mapping from company_id to company name."""
    company_map: dict[str, str] = {}
    for company in companies:
        if company.company_id:
            company_map[company.company_id] = company.name or company.company_id
    return company_map


def _extract_transitions(
    records: list[TaskTimelineRecord],
    response_deadline_days: int,
    timezone_name: str,
) -> tuple[list[TaskTransition], set[date]]:
    """Extract assign->completion transitions and calculate business days."""
    transitions: list[TaskTransition] = []

    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        pass

    holiday_dates: set[date] = set()
    if HOLIDAYS_AVAILABLE:
        try:
            holiday_dates = set(holidays.DK(years=range(2020, 2030)))
        except Exception:
            pass

    for record in records:
        events = list(record.events)

        for idx, event in enumerate(events):
            if event.action != "assign":
                continue

            for next_idx in range(idx + 1, len(events)):
                next_event = events[next_idx]
                if next_event.action in ["complete", "approve", "reject"]:
                    business_days = _business_days_between(
                        event.timestamp, next_event.timestamp, holiday_dates
                    )

                    transitions.append(
                        TaskTransition(
                            task_id=record.task_id,
                            label=record.label,
                            assign_timestamp=event.timestamp,
                            complete_timestamp=next_event.timestamp,
                            assign_action=event.action,
                            complete_action=next_event.action,
                            assigned_to=event.assignee,
                            assigned_to_company=record.company_name,
                            completed_by=next_event.assignee,
                            completed_by_company=record.company_name,
                            business_days=business_days,
                        )
                    )
                    break

    return transitions, holiday_dates


def build_timeline_records(
    tasks: list[Task],
    changes: list[TaskChange],
    user_id_to_name: dict[str, str] | None = None,
    user_company_map: dict[str, tuple[str, str]] | None = None,
    company_name_map: dict[str, str] | None = None,
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
        company_id: str | None = None
        company_name: str | None = None
        events = [LifecycleEvent(timestamp=created, action="created", description=title)]

        for change in task_changes:
            fields = change.fields
            change_status = fields.status if fields else None
            actor = (fields.current_responsible or fields.assigned_to) if fields else None
            change_assignee = _actor_label(actor, user_id_to_name)
            change_company_id, change_company_name = _get_actor_company(
                actor, user_company_map, company_name_map
            )
            change_deadline = _parse_datetime(fields.deadline) if fields else None
            if change_status:
                status = change_status
            if change_assignee:
                assignee = change_assignee
            if change_company_id:
                company_id = change_company_id
            if change_company_name:
                company_name = change_company_name
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
                company_id=company_id,
                company_name=company_name,
                events=tuple(sorted(events, key=lambda event: event.timestamp)),
            )
        )

    return sorted(records, key=lambda record: (record.created, record.label), reverse=True)


def _local_datetime(value: datetime, target_timezone: ZoneInfo) -> datetime:
    aware_value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware_value.astimezone(target_timezone)


def _to_utc_datetime(value: datetime) -> datetime:
    """Convert a datetime to UTC, localizing if necessary."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _business_days_between(
    start: datetime, end: datetime, holiday_dates: set[date] | None = None
) -> int:
    """Calculate business days between two datetimes, excluding weekends and holidays."""
    if end <= start:
        return 0

    start_utc = _to_utc_datetime(start)
    end_utc = _to_utc_datetime(end)

    start_date = start_utc.date()
    end_date = end_utc.date()

    if end_date <= start_date:
        return 0

    business_days = 0
    current_date = start_date + timedelta(days=1)  # Start counting from next day

    while current_date <= end_date:
        if current_date.weekday() < 5:  # Monday=0, Friday=4
            if holiday_dates is None or current_date not in holiday_dates:
                business_days += 1
        current_date += timedelta(days=1)

    return business_days


def build_figure(
    records: list[TaskTimelineRecord],
    timezone_name: str,
    response_deadline_days: int = 10,
) -> go.Figure:
    """Build a responsive Plotly lifecycle figure with colored transitions."""
    import plotly.graph_objects as go

    try:
        target_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timezone: {timezone_name}") from exc

    transitions, _ = _extract_transitions(records, response_deadline_days, timezone_name)

    transition_map: dict[str, list[TaskTransition]] = {}
    for transition in transitions:
        transition_map.setdefault(transition.task_id, []).append(transition)

    figure = go.Figure()
    for record in reversed(records):
        timestamps = [_local_datetime(event.timestamp, target_timezone) for event in record.events]

        default_line_color = "#64748b"
        default_marker_color = "#0f766e"

        task_transitions = transition_map.get(record.task_id, [])

        for transition in task_transitions:
            assign_local = _local_datetime(transition.assign_timestamp, target_timezone)
            complete_local = _local_datetime(transition.complete_timestamp, target_timezone)

            is_over_deadline = transition.business_days > response_deadline_days
            line_color = "#dc2626" if is_over_deadline else "#2563eb"

            hover_text = (
                f"{record.label}: {transition.assign_action} -> {transition.complete_action}<br>"
            )
            hover_text += f"Assigned to: {transition.assigned_to or 'Unknown'}<br>"
            if transition.assigned_to_company:
                hover_text += f"Company: {transition.assigned_to_company}<br>"
            hover_text += f"Response time: {transition.business_days} business days"

            figure.add_trace(
                go.Scatter(
                    x=[assign_local, complete_local],
                    y=[record.label, record.label],
                    mode="lines",
                    name=f"{record.label} transition",
                    text=[hover_text, hover_text],
                    hovertemplate="%{text}<br>%{x|%Y-%m-%d %H:%M}<extra></extra>",
                    line={"color": line_color, "width": 4},
                    showlegend=False,
                )
            )

        figure.add_trace(
            go.Scatter(
                x=timestamps,
                y=[record.label] * len(timestamps),
                mode="lines+markers",
                name=record.label,
                text=[
                    "<br>".join(
                        part
                        for part in (
                            f"{record.label}: {event.action.title()}",
                            event.description,
                            f"Status: {event.status}" if event.status else None,
                            f"Assignee: {event.assignee}" if event.assignee else None,
                            f"Company: {record.company_name}" if record.company_name else None,
                        )
                        if part
                    )
                    for event in record.events
                ],
                hovertemplate="%{text}<br>%{x|%Y-%m-%d %H:%M}<extra></extra>",
                line={"color": default_line_color, "width": 1, "dash": "dot"},
                marker={"size": 7, "color": default_marker_color},
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
    assignees: list[str],
    companies: list[str],
    created_before: datetime | None = None,
    created_after: datetime | None = None,
    deadline_before: datetime | None = None,
    deadline_after: datetime | None = None,
) -> list[TaskTimelineRecord]:
    """Filter timeline records using the dashboard sidebar selections."""
    normalized_search = search.strip().lower()
    filtered = []
    for record in records:
        if task_ids and record.task_id not in task_ids:
            continue
        if statuses and record.status not in statuses:
            continue
        if actions and not any(event.action in actions for event in record.events):
            continue
        if assignees and record.assignee not in assignees:
            continue
        if companies and record.company_name not in companies:
            continue
        if created_before and record.created > created_before:
            continue
        if created_after and record.created < created_after:
            continue
        if deadline_before and record.deadline and record.deadline > deadline_before:
            continue
        if deadline_after and record.deadline and record.deadline < deadline_after:
            continue
        if normalized_search:
            search_text = (
                record.label.lower()
                + (record.title or "").lower()
                + record.task_id.lower()
                + (record.assignee or "").lower()
                + (record.company_name or "").lower()
            )
            if normalized_search not in search_text:
                continue
        filtered.append(record)
    return filtered


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
    tasks = client.tasks.get_project_tasks(params=_query_params(options), project_id=project_id)
    changes = client.tasks.get_project_task_changes(project_id=project_id)

    users = client.users.list_project_users(project_id=project_id)
    companies = client.companies.list_project_companies(project_id=project_id)

    user_id_to_name = _build_user_name_map(users) if users else None
    user_company_map = _build_user_company_map(users) if users else None
    company_name_map = _build_company_name_map(companies) if companies else None

    records = build_timeline_records(
        tasks, changes, user_id_to_name, user_company_map, company_name_map
    )
    if not records:
        st.info("No tasks with lifecycle timestamps matched this dashboard.")
        return

    status_values = sorted({record.status for record in records if record.status})
    action_values = sorted({event.action for record in records for event in record.events})
    task_names = {record.task_id: record.label for record in records}
    assignee_values = sorted({record.assignee for record in records if record.assignee})
    company_values = sorted({record.company_name for record in records if record.company_name})
    all_created = [record.created for record in records]
    all_deadlines = [record.deadline for record in records if record.deadline]
    min_created = min(all_created) if all_created else None
    max_created = max(all_created) if all_created else None
    min_deadline = min(all_deadlines) if all_deadlines else None
    max_deadline = max(all_deadlines) if all_deadlines else None

    st.sidebar.markdown("**Basic filters**")
    selected_task_ids = st.sidebar.multiselect(
        "Task ID",
        sorted(task_names, key=lambda task_id: task_names[task_id]),
        format_func=task_names.__getitem__,
    )
    selected_statuses = st.sidebar.multiselect("Status", status_values)
    selected_actions = st.sidebar.multiselect("Lifecycle event", action_values)
    selected_assignees = st.sidebar.multiselect("Assignee", assignee_values)
    selected_companies = st.sidebar.multiselect("Company", company_values)
    search = st.sidebar.text_input("Search tasks")

    st.sidebar.markdown("**Response deadline settings**")
    response_deadline_days = st.sidebar.number_input(
        "Response deadline (business days)",
        min_value=1,
        max_value=30,
        value=10,
        help="Tasks taking longer than this to respond will be highlighted in red",
    )

    st.sidebar.markdown("**Date filters**")
    if min_created and max_created:
        created_range = st.sidebar.slider(
            "Created date range",
            min_value=min_created,
            max_value=max_created,
            value=(min_created, max_created),
        )
        created_after = created_range[0]
        created_before = created_range[1]
    else:
        created_after = None
        created_before = None

    if min_deadline and max_deadline:
        deadline_range = st.sidebar.slider(
            "Deadline date range",
            min_value=min_deadline,
            max_value=max_deadline,
            value=(min_deadline, max_deadline),
        )
        deadline_after = deadline_range[0]
        deadline_before = deadline_range[1]
    else:
        deadline_after = None
        deadline_before = None

    filtered = filter_timeline_records(
        records,
        task_ids=selected_task_ids,
        statuses=selected_statuses,
        actions=selected_actions,
        search=search,
        assignees=selected_assignees,
        companies=selected_companies,
        created_before=created_before,
        created_after=created_after,
        deadline_before=deadline_before,
        deadline_after=deadline_after,
    )

    metric_columns = st.columns(3)
    metric_columns[0].metric("Tasks", len(filtered))
    metric_columns[1].metric("With deadline", sum(item.deadline is not None for item in filtered))
    metric_columns[2].metric("Lifecycle events", sum(len(item.events) for item in filtered))
    if not filtered:
        st.info("No tasks matched the selected filters.")
        return

    st.plotly_chart(
        build_figure(filtered, timezone_name, response_deadline_days), use_container_width=True
    )
    st.dataframe(
        [
            {
                "Task": record.label,
                "Title": record.title,
                "Status": record.status,
                "Assignee": record.assignee,
                "Company": record.company_name,
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
