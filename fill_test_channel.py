#!/usr/bin/env python3
"""Script to fill spam-test-channel with test messages."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import discord
from dotenv import load_dotenv


CHANNEL_ID = 1424286238533226557  # spam-test-channel

TEST_MESSAGES = [
    "Hey everyone, I found a bug in the authentication flow. When I try to login with a long password, it crashes.",
    "Could we add a feature to export reports as PDF? That would be really helpful for our team.",
    "The dashboard is loading really slowly today. Anyone else experiencing this?",
    "Feature request: dark mode for the mobile app!",
    "I'm getting a 500 error when trying to upload files larger than 10MB.",
    "Bug report: the search function doesn't work with special characters like @#$",
    "Any update on the API rate limiting issue from last week? Still waiting for a fix.",
    "Suggestion: add keyboard shortcuts for common actions",
    "The new update broke the export feature. Getting 'undefined' errors everywhere.",
    "Help! I'm stuck trying to configure the webhook settings. Anyone know how to do this?",
    "Feature idea: batch processing for imports",
    "Critical bug: users can't reset their passwords. This is blocking production!",
    "Love the new UI changes! Great work team!",
    "Question: is there a way to customize the notification preferences?",
    "The mobile app crashes every time I try to open settings.",
]


async def main() -> None:
    # Load environment variables
    env_path = Path(__file__).parent / ".env"
    load_dotenv(env_path)

    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        print("Error: DISCORD_BOT_TOKEN not found in .env file")
        return

    # Create Discord client
    intents = discord.Intents.default()
    intents.message_content = True
    intents.guilds = True

    client = discord.Client(intents=intents)

    @client.event
    async def on_ready() -> None:
        print(f"Logged in as {client.user}")

        # Get the channel
        channel = client.get_channel(CHANNEL_ID)
        if not channel:
            print(f"Error: Could not find channel with ID {CHANNEL_ID}")
            await client.close()
            return

        if not isinstance(channel, discord.TextChannel):
            print(f"Error: Channel is not a text channel")
            await client.close()
            return

        print(f"Found channel: #{channel.name}")
        print(f"Sending {len(TEST_MESSAGES)} test messages...")

        # Send test messages
        for i, message in enumerate(TEST_MESSAGES, 1):
            try:
                await channel.send(message)
                print(f"  [{i}/{len(TEST_MESSAGES)}] Sent message")
                await asyncio.sleep(1)  # Be nice to Discord API
            except discord.Forbidden:
                print(f"  Error: Bot doesn't have permission to send messages!")
                print(f"  Please add 'Send Messages' permission to the bot")
                await client.close()
                return
            except Exception as e:
                print(f"  Error sending message: {e}")
                await client.close()
                return

        print(f"\n✅ Successfully sent {len(TEST_MESSAGES)} test messages!")
        await client.close()

    try:
        await client.start(token)
    except Exception as e:
        print(f"Error connecting to Discord: {e}")


if __name__ == "__main__":
    asyncio.run(main())
