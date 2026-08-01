"""Cron validation and timezone-aware next-run calculation."""

from datetime import datetime, timezone
from typing import cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter


def validate_timezone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"unknown IANA timezone: {name}") from exc


def next_run(cron: str, timezone_name: str, after: datetime | None = None) -> datetime:
    fields = cron.split()
    if len(fields) != 5 or not croniter.is_valid(cron):
        raise ValueError("cron must be a valid five-field expression")
    zone = validate_timezone(timezone_name)
    base = after or datetime.now(timezone.utc)
    local = base.astimezone(zone)
    result = cast(datetime, croniter(cron, local).get_next(datetime))
    if result.tzinfo is None:
        result = result.replace(tzinfo=zone)
    return result.astimezone(timezone.utc)
