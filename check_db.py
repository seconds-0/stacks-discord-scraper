#!/usr/bin/env python3
"""Check messages in database."""

import asyncio
import aiosqlite
from datetime import datetime, timezone


async def main():
    async with aiosqlite.connect("src/data/app.db") as db:
        # Count total messages
        cursor = await db.execute("SELECT COUNT(*) FROM messages")
        count = (await cursor.fetchone())[0]
        print(f"Total messages in DB: {count}")

        # Show recent messages
        cursor = await db.execute("""
            SELECT m.message_id, m.content, m.created_at, c.name as channel_name
            FROM messages m
            JOIN channels c ON m.channel_id = c.channel_id
            ORDER BY m.created_at DESC
            LIMIT 10
        """)

        print("\nRecent messages:")
        async for row in cursor:
            msg_id, content, created_at, channel = row
            # Truncate content
            content_preview = content[:60] + "..." if len(content) > 60 else content
            print(f"  [{channel}] {created_at}: {content_preview}")


if __name__ == "__main__":
    asyncio.run(main())
