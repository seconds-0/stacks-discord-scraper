#!/usr/bin/env python3
"""Script to list all Discord channels the bot can see."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import discord
from dotenv import load_dotenv


async def main() -> None:
    # Load environment variables
    env_path = Path(__file__).parent / ".env"
    load_dotenv(env_path)

    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        print("Error: DISCORD_BOT_TOKEN not found in .env file")
        return

    # Create Discord client with minimal intents
    intents = discord.Intents.default()
    intents.message_content = True
    intents.guilds = True

    client = discord.Client(intents=intents)

    @client.event
    async def on_ready() -> None:
        print(f"Logged in as {client.user}")
        print("\n" + "=" * 80)
        print("DISCORD CHANNELS")
        print("=" * 80 + "\n")

        # List all guilds (servers) and their channels
        for guild in client.guilds:
            print(f"Server: {guild.name} (ID: {guild.id})")
            print("-" * 80)

            # Get all text channels
            text_channels = [ch for ch in guild.channels if isinstance(ch, discord.TextChannel)]

            if not text_channels:
                print("  No text channels found\n")
                continue

            for channel in text_channels:
                print(f"  #{channel.name}")
                print(f"    ID: {channel.id}")
                print(f"    Category: {channel.category.name if channel.category else 'None'}")
                print()

            print()

        # Print comma-separated list of all channel IDs for easy copy-paste
        all_channel_ids = []
        for guild in client.guilds:
            for channel in guild.channels:
                if isinstance(channel, discord.TextChannel):
                    all_channel_ids.append(str(channel.id))

        print("=" * 80)
        print("ALL CHANNEL IDs (for DISCORD_CHANNEL_ALLOWLIST):")
        print("=" * 80)
        print(",".join(all_channel_ids))
        print()

        await client.close()

    try:
        await client.start(token)
    except Exception as e:
        print(f"Error connecting to Discord: {e}")


if __name__ == "__main__":
    asyncio.run(main())
