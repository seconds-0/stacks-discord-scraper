#!/usr/bin/env python3
"""Debug window calculation and message retrieval."""

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from digestbot.config import load_settings
from digestbot.db import Database
from digestbot.windowing import compute_window


async def main():
    settings = load_settings()
    db = Database(Path("src") / settings.database_path)
    await db.connect()

    now = datetime.now(settings.timezone)
    window_start, window_end = compute_window(now, settings.digest_window_hours, settings.timezone)

    print(f"Current time: {now}")
    print(f"Window: {window_start} to {window_end}")
    print()

    messages = await db.fetch_messages_between(window_start, window_end)
    print(f"Messages found: {len(messages)}")

    if messages:
        for msg in messages:
            print(f"  [{msg.channel_name}] {msg.created_at}: {msg.content[:60]}")
    else:
        # Check all messages in spam-test-channel
        cursor = await db._conn.execute("""
            SELECT m.message_id, m.content, m.created_at, c.name
            FROM messages m
            JOIN channels c ON m.channel_id = c.channel_id
            WHERE c.name = 'spam-test-channel'
            ORDER BY m.created_at DESC
            LIMIT 10
        """)
        rows = await cursor.fetchall()
        print("\nAll messages in spam-test-channel:")
        for row in rows:
            msg_id, content, created_at, channel = row
            print(f"  {created_at}: {content[:60]}")

    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
