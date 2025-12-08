# Scheduler Reference

## Requirement
- Run the digest job once daily at 5:00 AM PT (America/Los_Angeles), DST‑aware.

## Approach (Python)
- Use `APScheduler` with a cron trigger and timezone `America/Los_Angeles`.
- Compute the window as the prior 24 hours ending exactly at the scheduled wall time.

## Example (pseudo‑code)
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

tz = pytz.timezone('America/Los_Angeles')
scheduler = AsyncIOScheduler(timezone=tz)
trigger = CronTrigger(hour=5, minute=0, timezone=tz)

def run_digest():
    # compute [T-24h, T) where T is 5:00 AM local today
    pass

scheduler.add_job(run_digest, trigger, id='daily_digest', replace_existing=True)
scheduler.start()
```

## Notes
- If the process is down at 5:00 AM, run the job at next start and backfill the missed window.
- Consider a lock (DB row) to avoid double‑posting.

