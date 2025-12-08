from __future__ import annotations

import logging
import math
import re
from collections import defaultdict
from dataclasses import asdict, replace
from datetime import datetime
from typing import Dict, List, Optional

from .config import Settings
from .db import Database
from .models import DigestResult, Finding, MessageRecord
from .slack_notifier import SlackNotifier
from .summarizer import BaseSummarizer
from .windowing import compute_daily_window, compute_window


logger = logging.getLogger(__name__)


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://\S+")
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{24,}")


class DigestService:
    def __init__(
        self,
        db: Database,
        summarizer: BaseSummarizer,
        slack: SlackNotifier,
        settings: Settings,
    ) -> None:
        self.db = db
        self.summarizer = summarizer
        self.slack = slack
        self.settings = settings

    async def run_digest(self, now: Optional[datetime] = None) -> Optional[int]:
        moment = now or datetime.now(self.settings.timezone)
        window_start, window_end = self._compute_window(moment)
        logger.info("Running digest for window %s -> %s", window_start, window_end)

        messages = await self.db.fetch_messages_between(window_start, window_end)

        async with self.db.transaction():
            batch_id = await self.db.create_batch(
                window_start,
                window_end,
                token_estimate=self._estimate_tokens(messages),
                commit=False,
            )

        if not messages:
            logger.info("No messages found for window; storing empty summary")
            empty_result = DigestResult(
                window_start=window_start,
                window_end=window_end,
                channel_digests=[],
                global_summary=[],
                total_messages=0,
            )
            async with self.db.transaction():
                await self.db.store_summary(
                    batch_id,
                    self._digest_to_json(empty_result, []),
                    "No activity in the window",
                    commit=False,
                )
                await self.db.set_batch_status(batch_id, "completed", commit=False)
            return batch_id

        channel_messages: Dict[int, List[MessageRecord]] = defaultdict(list)
        for message in messages:
            channel_messages[message.channel_id].append(message)

        sanitized_payload = {
            channel_id: [replace(msg, content=self._redact_content(msg.content)) for msg in msg_list]
            for channel_id, msg_list in channel_messages.items()
        }

        channel_digests, global_summary, findings = await self.summarizer.summarize(
            window_start,
            window_end,
            sanitized_payload,
        )

        digest_result = DigestResult(
            window_start=window_start,
            window_end=window_end,
            channel_digests=channel_digests,
            global_summary=global_summary,
            total_messages=len(messages),
        )

        async with self.db.transaction():
            await self.db.attach_batch_messages(batch_id, [m.message_id for m in messages], commit=False)
            await self.db.store_findings(batch_id, findings, commit=False)
            highlights = "\n".join(global_summary[:5]) if global_summary else ""
            await self.db.store_summary(
                batch_id,
                self._digest_to_json(digest_result, findings),
                highlights,
                commit=False,
            )

        slack_ts: Optional[str] = None
        try:
            slack_ts = await self.slack.post_digest(digest_result, findings)
        except Exception:
            logger.exception("Slack posting failed for batch %s", batch_id)

        async with self.db.transaction():
            if slack_ts:
                await self.db.record_slack_post(
                    batch_id,
                    datetime.now(self.settings.timezone),
                    slack_ts,
                    commit=False,
                )
            await self.db.set_batch_status(batch_id, "completed", commit=False)
        logger.info("Digest batch %s completed", batch_id)
        return batch_id

    def _compute_window(self, now: datetime) -> tuple[datetime, datetime]:
        if self.settings.digest_window_hours == 24:
            return compute_daily_window(now, self.settings.timezone)
        return compute_window(now, self.settings.digest_window_hours, self.settings.timezone)

    def _estimate_tokens(self, messages: List[MessageRecord]) -> int:
        if not messages:
            return 0
        estimated = 0
        for message in messages:
            text = message.content or ""
            word_count = len(text.split())
            estimated += max(4, int(math.ceil(word_count * 1.3)) + 4)
        return estimated

    def _digest_to_json(self, digest: DigestResult, findings: List[Finding]) -> dict:
        return {
            "window_start": digest.window_start.isoformat(),
            "window_end": digest.window_end.isoformat(),
            "total_messages": digest.total_messages,
            "global_summary": digest.global_summary,
            "channels": [
                {
                    "channel_id": channel.channel_id,
                    "channel_name": channel.channel_name,
                    "server_id": channel.server_id,
                    "server_name": channel.server_name,
                    "total_messages": channel.total_messages,
                    "summary_bullets": channel.summary_bullets,
                    "feature_requests": [asdict(f) for f in channel.feature_requests],
                    "bugs": [asdict(f) for f in channel.bugs],
                    "unresolved": [asdict(f) for f in channel.unresolved],
                }
                for channel in digest.channel_digests
            ],
            "findings": [asdict(f) for f in findings],
        }

    def _redact_content(self, text: str | None) -> str:
        if not text:
            return ""
        redacted = EMAIL_RE.sub("[redacted-email]", text)
        redacted = URL_RE.sub("[redacted-url]", redacted)
        redacted = TOKEN_RE.sub("[redacted-token]", redacted)
        return redacted


__all__ = ["DigestService"]
