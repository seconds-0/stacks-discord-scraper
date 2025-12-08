"""Discord integration for DigestBot.

This module provides Discord message ingestion, channel monitoring,
and message persistence functionality.
"""

from __future__ import annotations

import asyncio
import json
import logging

import discord

from .config import Settings
from .db import Database


logger = logging.getLogger(__name__)


INITIAL_SYNC_RETRY_SECONDS = 30


class DiscordIngestor(discord.Client):
    """Discord client for ingesting messages and persisting them to database.
    
    Handles Discord connection, message monitoring, channel filtering,
    and message persistence with proper error handling and retry logic.
    """
    
    def __init__(self, database: Database, settings: Settings) -> None:
        """Initialize Discord ingestor.
        
        Args:
            database: Database instance for message persistence
            settings: Application settings
        """
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.members = True
        super().__init__(intents=intents)
        self.db = database
        self.settings = settings
        self._ready_event = asyncio.Event()

    async def setup_hook(self) -> None:
        self.loop.create_task(self._initial_sync())

    async def on_ready(self) -> None:
        logger.info("Connected to Discord as %s (id=%s)", self.user, self.user.id if self.user else "unknown")
        self._ready_event.set()

    async def on_message(self, message: discord.Message) -> None:
        if not self._should_capture(message):
            return
        await self._persist_message(message)

    async def _initial_sync(self) -> None:
        await self.wait_until_ready()
        logger.info("Running initial channel sync and backfill")
        try:
            for guild in self.guilds:
                await self._register_guild(guild)
                for channel in guild.text_channels:
                    if not self._is_channel_allowed(channel):
                        continue
                    try:
                        await self._backfill_channel(channel)
                    except Exception:
                        logger.exception("Backfill failed for channel #%s", channel.name)
                    for thread in channel.threads:
                        if not self._is_channel_allowed(thread):
                            continue
                        try:
                            await self._backfill_thread(thread)
                        except Exception:
                            logger.exception("Backfill failed for thread #%s", thread.name)
        except Exception:
            logger.exception("Initial Discord sync failed; retrying in %s seconds", INITIAL_SYNC_RETRY_SECONDS)
            await asyncio.sleep(INITIAL_SYNC_RETRY_SECONDS)
            self.loop.create_task(self._initial_sync())
            return
        logger.info("Initial backfill complete")

    async def _register_guild(self, guild: discord.Guild) -> None:
        await self.db.upsert_server(guild.id, guild.name, guild.created_at)

    async def _persist_message(self, message: discord.Message) -> None:
        guild = message.guild
        if guild is None:
            return
        channel = message.channel
        if not isinstance(channel, (discord.abc.GuildChannel, discord.Thread)):
            return
        if not self._is_channel_allowed(channel):
            return

        stored = False
        async with self.db.transaction():
            await self.db.upsert_server(guild.id, guild.name, guild.created_at, commit=False)
            await self._register_channel(channel, commit=False)

            author = message.author
            username = str(author)
            is_bot = getattr(author, "bot", False)
            role_hints = None
            if isinstance(author, discord.Member):
                roles = [role.name for role in author.roles if not role.is_default()]
                if roles:
                    role_hints = ",".join(roles)
            await self.db.upsert_author(author.id, username, is_bot, role_hints, message.created_at, commit=False)

            parent_message_id = message.reference.message_id if message.reference else None
            raw_json = json.dumps(self._serialize_message(message))
            stored = await self.db.insert_message(
                message_id=message.id,
                channel_id=channel.id,
                author_id=author.id,
                content=message.content or "",
                created_at=message.created_at,
                is_reply=parent_message_id is not None,
                parent_message_id=parent_message_id,
                has_attachments=bool(message.attachments),
                raw_json=raw_json,
                commit=False,
            )

            if stored:
                await self.db.update_channel_cursor(channel.id, message.id, message.created_at, commit=False)

        if stored:
            logger.debug("Stored message %s in #%s", message.id, getattr(channel, "name", channel.id))

    async def _register_channel(self, channel: discord.abc.GuildChannel | discord.Thread, *, commit: bool = True) -> None:
        if not hasattr(channel, "guild") or channel.guild is None:
            return
        server_id = channel.guild.id
        name = channel.name if hasattr(channel, "name") else str(channel.id)
        is_thread = isinstance(channel, discord.Thread)
        parent_id = getattr(channel, "parent_id", None) if is_thread else None
        await self.db.upsert_channel(channel.id, server_id, name, is_thread, parent_id, commit=commit)

    async def _backfill_channel(self, channel: discord.TextChannel) -> None:
        await self._register_channel(channel)
        last_seen = await self.db.get_channel_cursor(channel.id)
        kwargs: dict = {"limit": self.settings.discord_initial_backfill_limit, "oldest_first": True}
        if last_seen:
            kwargs["after"] = discord.Object(id=last_seen)
        logger.info("Backfilling channel #%s (last_seen=%s)", channel.name, last_seen)
        async for message in channel.history(**kwargs):
            if self._should_capture(message):
                await self._persist_message(message)

    async def _backfill_thread(self, thread: discord.Thread) -> None:
        await self._register_channel(thread)
        last_seen = await self.db.get_channel_cursor(thread.id)
        kwargs: dict = {"limit": self.settings.discord_initial_backfill_limit, "oldest_first": True}
        if last_seen:
            kwargs["after"] = discord.Object(id=last_seen)
        logger.info("Backfilling thread #%s (last_seen=%s)", thread.name, last_seen)
        async for message in thread.history(**kwargs):
            if self._should_capture(message):
                await self._persist_message(message)

    def _should_capture(self, message: discord.Message) -> bool:
        if message.author == self.user:
            return False
        if getattr(message.author, "bot", False):
            return False
        if message.guild is None:
            return False
        return self._is_channel_allowed(message.channel)

    def _is_channel_allowed(self, channel: discord.abc.GuildChannel | discord.Thread) -> bool:
        if isinstance(channel, discord.DMChannel):
            return False
        allow = self.settings.discord_channel_allowlist
        deny = self.settings.discord_channel_denylist
        channel_id = getattr(channel, "id", None)
        if channel_id is None:
            return False
        if allow and channel_id not in allow:
            # allow threads when parent is explicitly whitelisted
            if isinstance(channel, discord.Thread) and channel.parent_id in allow:
                pass
            else:
                return False
        if deny and channel_id in deny:
            return False
        return True

    def _serialize_message(self, message: discord.Message) -> dict:
        return {
            "id": message.id,
            "channel_id": message.channel.id if message.channel else None,
            "guild_id": message.guild.id if message.guild else None,
            "content": message.content,
            "created_at": message.created_at.isoformat() if message.created_at else None,
            "author": {
                "id": message.author.id,
                "name": str(message.author),
                "bot": getattr(message.author, "bot", False),
            },
            "reference": message.reference.to_dict() if message.reference else None,
            "mentions": [user.id for user in message.mentions],
            "attachments": [
                {
                    "id": att.id,
                    "filename": att.filename,
                    "url": att.url,
                    "content_type": att.content_type,
                }
                for att in message.attachments
            ],
        }


__all__ = ["DiscordIngestor"]
