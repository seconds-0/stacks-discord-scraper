from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional

import aiosqlite

logger = logging.getLogger(__name__)


class DatabaseMigrator:
    """Handles database schema migrations and initialization."""
    
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.migrations_dir = Path(__file__).parent / "migrations"
        self.migrations_dir.mkdir(exist_ok=True)
    
    async def initialize_database(self) -> None:
        """Initialize the database with the current schema."""
        logger.info("Initializing database at %s", self.db_path)
        
        # Ensure parent directory exists
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        async with aiosqlite.connect(self.db_path) as conn:
            conn.row_factory = aiosqlite.Row
            await conn.execute("PRAGMA foreign_keys = ON;")
            await conn.executescript(self._get_base_schema())
            await conn.commit()
            
        logger.info("Database initialized successfully")
    
    async def run_migrations(self) -> None:
        """Run any pending migrations."""
        logger.info("Checking for pending migrations")
        
        async with aiosqlite.connect(self.db_path) as conn:
            conn.row_factory = aiosqlite.Row
            
            # Create migrations table if it doesn't exist
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                )
            """)
            await conn.commit()
            
            # Get applied migrations
            cursor = await conn.execute("SELECT version FROM schema_migrations ORDER BY version")
            applied_versions = {row[0] for row in await cursor.fetchall()}
            
            # Find migration files
            migration_files = sorted(self.migrations_dir.glob("*.sql"))
            pending_migrations = []
            
            for migration_file in migration_files:
                version = int(migration_file.stem)
                if version not in applied_versions:
                    pending_migrations.append((version, migration_file))
            
            if not pending_migrations:
                logger.info("No pending migrations")
                return
            
            logger.info("Found %d pending migrations", len(pending_migrations))
            
            # Apply migrations
            for version, migration_file in pending_migrations:
                logger.info("Applying migration %d from %s", version, migration_file.name)
                
                migration_sql = migration_file.read_text()
                await conn.executescript(migration_sql)
                
                await conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?)",
                    (version,)
                )
                await conn.commit()
                
                logger.info("Migration %d applied successfully", version)
    
    def _get_base_schema(self) -> str:
        """Get the base database schema."""
        return """
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


async def setup_database(db_path: Path) -> None:
    """Set up the database with migrations."""
    migrator = DatabaseMigrator(db_path)
    await migrator.initialize_database()
    await migrator.run_migrations()
