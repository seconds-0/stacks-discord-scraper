from __future__ import annotations

import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import Settings
from .digest_service import DigestService


logger = logging.getLogger(__name__)


class DigestScheduler:
    def __init__(self, digest_service: DigestService, settings: Settings) -> None:
        self.digest_service = digest_service
        self.settings = settings
        self.scheduler = AsyncIOScheduler(timezone=settings.timezone)
        self._job = None

    async def start(self) -> None:
        trigger = CronTrigger.from_crontab(self.settings.digest_cron, timezone=self.settings.timezone)
        self._job = self.scheduler.add_job(self._run_digest_job, trigger, id="daily_digest", max_instances=1, coalesce=True)
        self.scheduler.start()
        logger.info("Digest scheduler started with cron %s", self.settings.digest_cron)
        if self.settings.digest_run_on_start:
            try:
                await self.digest_service.run_digest()
            except Exception:
                logger.exception("Initial digest run failed")

    async def shutdown(self) -> None:
        if self.scheduler.running:
            await self.scheduler.shutdown(wait=False)
            logger.info("Digest scheduler shutdown")

    async def _run_digest_job(self) -> None:
        try:
            await self.digest_service.run_digest()
        except Exception:
            logger.exception("Scheduled digest run failed")


__all__ = ["DigestScheduler"]
