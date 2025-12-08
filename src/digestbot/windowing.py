from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


def compute_window(now: datetime, window_hours: int, tz: ZoneInfo) -> tuple[datetime, datetime]:
    if now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    end = now.astimezone(tz)
    start = end - timedelta(hours=window_hours)
    return start, end


def compute_daily_window(
    now: datetime,
    tz: ZoneInfo,
    anchor_hour: int = 5,
    anchor_minute: int = 0,
) -> tuple[datetime, datetime]:
    local_now = now.astimezone(tz)
    anchor = local_now.replace(hour=anchor_hour, minute=anchor_minute, second=0, microsecond=0)
    if local_now < anchor:
        anchor -= timedelta(days=1)
    start = anchor - timedelta(days=1)
    return start, anchor


__all__ = ["compute_window", "compute_daily_window"]
