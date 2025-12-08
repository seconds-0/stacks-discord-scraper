"""Database layer for DigestBot.

This module provides database operations for storing Discord messages,
generating digests, and managing application state.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Iterable, List, Optional

import aiosqlite

from .models import Finding, MessageRecord
from .migrations import setup_database


SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS discord_servers (
    server_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS channels (
    channel_id INTEGER PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES discord_servers(server_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_thread INTEGER NOT NULL DEFAULT 0,
    parent_channel_id INTEGER,
    last_seen_message_id INTEGER,
    last_seen_at TEXT,
    UNIQUE(channel_id)
);

CREATE TABLE IF NOT EXISTS authors (
    author_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    is_bot INTEGER NOT NULL DEFAULT 0,
    role_hints TEXT,
    first_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    message_id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES authors(author_id) ON DELETE CASCADE,
    content TEXT,
    created_at TEXT NOT NULL,
    is_reply INTEGER NOT NULL DEFAULT 0,
    parent_message_id INTEGER,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT
);

CREATE TABLE IF NOT EXISTS batches (
    batch_id INTEGER PRIMARY KEY AUTOINCREMENT,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    token_estimate INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'created',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS batch_messages (
    batch_id INTEGER NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
    PRIMARY KEY (batch_id, message_id)
);

CREATE TABLE IF NOT EXISTS summaries (
    batch_id INTEGER PRIMARY KEY REFERENCES batches(batch_id) ON DELETE CASCADE,
    json_result TEXT NOT NULL,
    highlights_text TEXT,
    posted_to_slack_at TEXT,
    slack_ts TEXT
);

CREATE TABLE IF NOT EXISTS findings (
    finding_id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT,
    confidence REAL,
    first_message_id INTEGER,
    message_ids_json TEXT,
    channel_id INTEGER,
    channel_name TEXT,
    status TEXT,
    tags_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_findings_batch_type ON findings(batch_id, type);
"""


class Database:
    """Database connection and operations manager.

    Provides async database operations for Discord message storage,
    digest generation, and application state management.
    """

    def __init__(self, path: Path) -> None:
        """Initialize database connection.

        Args:
            path: Path to SQLite database file
        """
        self.path = path
        self._conn: Optional[aiosqlite.Connection] = None

    async def connect(self) -> None:
        """Connect to the database and initialize schema.

        Sets up database with migrations and configures connection settings.
        """
        # Set up database with migrations
        await setup_database(self.path)

        # Connect to the database
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA foreign_keys = ON;")

    async def close(self) -> None:
        """Close the database connection."""
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        """Get the database connection.

        Returns:
            Active database connection

        Raises:
            RuntimeError: If connection is not initialized
        """
        if self._conn is None:
            raise RuntimeError("Database connection is not initialized")
        return self._conn

    async def commit(self) -> None:
        """Commit pending transactions."""
        await self.conn.commit()

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[aiosqlite.Connection]:
        """Context manager for database transactions.

        Yields:
            Database connection within transaction

        Raises:
            Any exception from the transaction block
        """
        await self.conn.execute("BEGIN")
        try:
            yield self.conn
        except Exception:
            await self.conn.rollback()
            raise
        else:
            await self.conn.commit()

    async def upsert_server(
        self, server_id: int, name: str, created_at: Optional[datetime], *, commit: bool = True
    ) -> None:
        """Insert or update Discord server information.

        Args:
            server_id: Discord server ID
            name: Server name
            created_at: Server creation timestamp
            commit: Whether to commit the transaction
        """
        await self.conn.execute(
            """
            INSERT INTO discord_servers(server_id, name, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(server_id) DO UPDATE SET name=excluded.name, created_at=excluded.created_at
            """,
            (server_id, name, created_at.isoformat() if created_at else None),
        )
        if commit:
            await self.conn.commit()

    async def upsert_channel(
        self,
        channel_id: int,
        server_id: int,
        name: str,
        is_thread: bool,
        parent_channel_id: Optional[int],
        *,
        commit: bool = True,
    ) -> None:
        """Insert or update Discord channel information.

        Args:
            channel_id: Discord channel ID
            server_id: Parent server ID
            name: Channel name
            is_thread: Whether this is a thread
            parent_channel_id: Parent channel ID for threads
            commit: Whether to commit the transaction
        """
        await self.conn.execute(
            """
            INSERT INTO channels(channel_id, server_id, name, is_thread, parent_channel_id)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(channel_id) DO UPDATE SET
                server_id=excluded.server_id,
                name=excluded.name,
                is_thread=excluded.is_thread,
                parent_channel_id=excluded.parent_channel_id
            """,
            (channel_id, server_id, name, int(is_thread), parent_channel_id),
        )
        if commit:
            await self.conn.commit()

    async def update_channel_cursor(
        self, channel_id: int, message_id: int, created_at: datetime, *, commit: bool = True
    ) -> None:
        """Update channel cursor to track last processed message.

        Args:
            channel_id: Discord channel ID
            message_id: Last processed message ID
            created_at: Message creation timestamp
            commit: Whether to commit the transaction
        """
        await self.conn.execute(
            """
            UPDATE channels
            SET last_seen_message_id = ?, last_seen_at = ?
            WHERE channel_id = ?
            """,
            (message_id, created_at.isoformat(), channel_id),
        )
        if commit:
            await self.conn.commit()

    async def get_channel_cursor(self, channel_id: int) -> Optional[int]:
        """Get the last processed message ID for a channel.

        Args:
            channel_id: Discord channel ID

        Returns:
            Last processed message ID, or None if not found
        """
        cursor = await self.conn.execute(
            "SELECT last_seen_message_id FROM channels WHERE channel_id = ?",
            (channel_id,),
        )
        row = await cursor.fetchone()
        if row:
            return row[0]
        return None

    async def upsert_author(
        self,
        author_id: int,
        username: str,
        is_bot: bool,
        role_hints: Optional[str],
        first_seen_at: datetime,
        *,
        commit: bool = True,
    ) -> None:
        """Insert or update Discord author information.

        Args:
            author_id: Discord user ID
            username: Username
            is_bot: Whether this is a bot
            role_hints: Role information
            first_seen_at: First seen timestamp
            commit: Whether to commit the transaction
        """
        await self.conn.execute(
            """
            INSERT INTO authors(author_id, username, is_bot, role_hints, first_seen_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(author_id) DO UPDATE SET
                username=excluded.username,
                is_bot=excluded.is_bot,
                role_hints=excluded.role_hints
            """,
            (author_id, username, int(is_bot), role_hints, first_seen_at.isoformat()),
        )
        if commit:
            await self.conn.commit()

    async def insert_message(
        self,
        message_id: int,
        channel_id: int,
        author_id: int,
        content: str,
        created_at: datetime,
        is_reply: bool,
        parent_message_id: Optional[int],
        has_attachments: bool,
        raw_json: str,
        *,
        commit: bool = True,
    ) -> bool:
        """Insert a Discord message into the database.

        Args:
            message_id: Discord message ID
            channel_id: Discord channel ID
            author_id: Discord user ID
            content: Message content
            created_at: Message creation timestamp
            is_reply: Whether this is a reply
            parent_message_id: Parent message ID for replies
            has_attachments: Whether message has attachments
            raw_json: Raw message JSON
            commit: Whether to commit the transaction

        Returns:
            True if message was inserted, False if duplicate
        """
        try:
            await self.conn.execute(
                """
                INSERT INTO messages(
                    message_id, channel_id, author_id, content, created_at,
                    is_reply, parent_message_id, has_attachments, raw_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    channel_id,
                    author_id,
                    content,
                    created_at.isoformat(),
                    int(is_reply),
                    parent_message_id,
                    int(has_attachments),
                    raw_json,
                ),
            )
            if commit:
                await self.conn.commit()
            return True
        except aiosqlite.IntegrityError:
            return False

    async def fetch_messages_between(
        self, window_start: datetime, window_end: datetime
    ) -> List[MessageRecord]:
        """Fetch messages within a time window.

        Args:
            window_start: Start of time window
            window_end: End of time window

        Returns:
            List of message records
        """
        # Convert to UTC for consistent string comparison in SQLite
        window_start_utc = window_start.astimezone(timezone.utc)
        window_end_utc = window_end.astimezone(timezone.utc)

        cursor = await self.conn.execute(
            """
            SELECT
                m.message_id,
                m.channel_id,
                c.name AS channel_name,
                c.server_id,
                s.name AS server_name,
                m.author_id,
                a.username,
                m.content,
                m.created_at,
                m.is_reply,
                m.parent_message_id,
                m.has_attachments,
                m.raw_json
            FROM messages m
            INNER JOIN channels c ON c.channel_id = m.channel_id
            INNER JOIN discord_servers s ON s.server_id = c.server_id
            INNER JOIN authors a ON a.author_id = m.author_id
            WHERE m.created_at >= ? AND m.created_at < ?
            ORDER BY c.channel_id, m.created_at
            """,
            (window_start_utc.isoformat(), window_end_utc.isoformat()),
        )
        rows = await cursor.fetchall()
        records: List[MessageRecord] = []
        for row in rows:
            records.append(
                MessageRecord(
                    message_id=row["message_id"],
                    channel_id=row["channel_id"],
                    channel_name=row["channel_name"],
                    server_id=row["server_id"],
                    server_name=row["server_name"],
                    author_id=row["author_id"],
                    author_name=row["username"],
                    content=row["content"] or "",
                    created_at=datetime.fromisoformat(
                        row["created_at"]
                    ),
                    is_reply=bool(row["is_reply"]),
                    parent_message_id=row["parent_message_id"],
                    has_attachments=bool(row["has_attachments"]),
                    raw_json=row["raw_json"] or "",
                )
            )
        return records

    async def create_batch(
        self,
        window_start: datetime,
        window_end: datetime,
        token_estimate: int = 0,
        *,
        commit: bool = True
    ) -> int:
        """Create a new digest batch.

        Args:
            window_start: Start of digest window
            window_end: End of digest window
            token_estimate: Estimated token count
            commit: Whether to commit the transaction

        Returns:
            Batch ID

        Raises:
            RuntimeError: If batch creation fails
        """
        cursor = await self.conn.execute(
            """
            INSERT INTO batches(window_start, window_end, token_estimate, status)
            VALUES (?, ?, ?, 'created')
            """,
            (window_start.isoformat(), window_end.isoformat(), token_estimate),
        )
        if commit:
            await self.conn.commit()
        batch_id = cursor.lastrowid
        if batch_id is None:
            raise RuntimeError("Failed to create batch - no row ID returned")
        return batch_id

    async def set_batch_status(self, batch_id: int, status: str, *, commit: bool = True) -> None:
        """Update batch status.

        Args:
            batch_id: Batch ID
            status: New status
            commit: Whether to commit the transaction
        """
        await self.conn.execute(
            "UPDATE batches SET status = ? WHERE batch_id = ?",
            (status, batch_id),
        )
        if commit:
            await self.conn.commit()

    async def attach_batch_messages(
        self, batch_id: int, message_ids: Iterable[int], *, commit: bool = True
    ) -> None:
        """Attach messages to a batch.

        Args:
            batch_id: Batch ID
            message_ids: Message IDs to attach
            commit: Whether to commit the transaction
        """
        await self.conn.executemany(
            "INSERT OR IGNORE INTO batch_messages(batch_id, message_id) VALUES (?, ?)",
            [(batch_id, mid) for mid in message_ids],
        )
        if commit:
            await self.conn.commit()

    async def store_summary(self, batch_id: int, json_result: dict, highlights_text: str, *, commit: bool = True) -> None:
        """Store digest summary.

        Args:
            batch_id: Batch ID
            json_result: Summary JSON result
            highlights_text: Highlights text
            commit: Whether to commit the transaction
        """
        await self.conn.execute(
            """
            INSERT INTO summaries(batch_id, json_result, highlights_text)
            VALUES (?, ?, ?)
            ON CONFLICT(batch_id) DO UPDATE SET
                json_result=excluded.json_result,
                highlights_text=excluded.highlights_text
            """,
            (batch_id, json.dumps(json_result), highlights_text),
        )
        if commit:
            await self.conn.commit()

    async def record_slack_post(
        self, batch_id: int, posted_at: datetime, slack_ts: Optional[str], *, commit: bool = True
    ) -> None:
        """Record Slack post information.

        Args:
            batch_id: Batch ID
            posted_at: Post timestamp
            slack_ts: Slack timestamp
            commit: Whether to commit the transaction
        """
        await self.conn.execute(
            """
            UPDATE summaries
            SET posted_to_slack_at = ?, slack_ts = ?
            WHERE batch_id = ?
            """,
            (posted_at.isoformat(), slack_ts, batch_id),
        )
        if commit:
            await self.conn.commit()

    async def store_findings(
        self, batch_id: int, findings: List[Finding], *, commit: bool = True
    ) -> None:
        """Store digest findings.

        Args:
            batch_id: Batch ID
            findings: List of findings
            commit: Whether to commit the transaction
        """
        await self.conn.execute("DELETE FROM findings WHERE batch_id = ?", (batch_id,))
        await self.conn.executemany(
            """
            INSERT INTO findings(
                batch_id, type, title, description, severity, confidence,
                first_message_id, message_ids_json, channel_id, channel_name,
                status, tags_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    batch_id,
                    finding.finding_type,
                    finding.title,
                    finding.description,
                    finding.severity,
                    finding.confidence,
                    finding.message_ids[0] if finding.message_ids else None,
                    json.dumps(finding.message_ids),
                    finding.channel_id,
                    finding.channel_name,
                    "open",
                    json.dumps(finding.tags),
                )
                for finding in findings
            ],
        )
        if commit:
            await self.conn.commit()
