#!/usr/bin/env python3
"""Run digest with custom time window for testing."""

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from digestbot.config import load_settings
from digestbot.db import Database
from digestbot.digest_service import DigestService
from digestbot.slack_notifier import SlackNotifier
from digestbot.summarizer import build_summarizer
from digestbot.logging_config import setup_logging


async def main():
    settings = load_settings()
    setup_logging(settings.log_level)

    db = Database(settings.database_path)
    await db.connect()

    summarizer = build_summarizer(
        settings.openrouter_api_key if settings.llm_active else None,
        settings.llm_model,
        settings.llm_max_output_tokens,
    )
    slack = SlackNotifier(settings.slack_bot_token, settings.slack_target_channel, settings.slack_post_enabled)
    digest_service = DigestService(db, summarizer, slack, settings)

    # Use current UTC time to match database timestamps
    now = datetime.now(timezone.utc).astimezone(settings.timezone)

    print(f"Running digest with current time: {now}")
    print(f"(Will compute window based on DIGEST_WINDOW_HOURS={settings.digest_window_hours})")

    await digest_service.run_digest(now)
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
