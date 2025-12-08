#!/usr/bin/env python3
"""Show the latest digest results."""

import asyncio
import json
import aiosqlite


async def main():
    async with aiosqlite.connect("src/data/app.db") as db:
        # Get latest batch
        cursor = await db.execute("""
            SELECT s.batch_id, b.window_start, b.window_end, s.json_result, s.highlights_text
            FROM summaries s
            JOIN batches b ON s.batch_id = b.batch_id
            ORDER BY s.batch_id DESC
            LIMIT 1
        """)
        row = await cursor.fetchone()

        if not row:
            print("No digests found")
            return

        batch_id, window_start, window_end, json_result, highlights = row

        print(f"Batch #{batch_id}")
        print(f"Window: {window_start} to {window_end}")
        print(f"\nHighlights:")
        print(highlights or "(none)")

        if json_result:
            data = json.loads(json_result)
            print(f"\nTotal messages: {data.get('total_messages', 0)}")

            print("\nGlobal summary:")
            for item in data.get('global_summary', []):
                print(f"  - {item}")

            print("\nFindings:")
            for finding in data.get('findings', []):
                print(f"  [{finding['finding_type']}] {finding['title']}")
                print(f"    Channel: #{finding['channel_name']}")
                print(f"    Confidence: {finding['confidence']}")
                print()


if __name__ == "__main__":
    asyncio.run(main())
