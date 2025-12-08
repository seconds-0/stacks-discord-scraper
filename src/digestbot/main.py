from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import signal
from pathlib import Path

from .config import Settings, load_settings
from .db import Database
from .digest_service import DigestService
from .discord_ingestor import DiscordIngestor
from .health import HealthMonitor
from .logging_config import setup_logging
from .scheduler import DigestScheduler
from .slack_notifier import SlackNotifier
from .summarizer import build_summarizer


logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Discord to Slack digest service")
    parser.add_argument("command", choices=["run", "digest-once", "health-check"], nargs="?", default="run")
    parser.add_argument("--env", help="Path to .env file", dest="env_file")
    return parser.parse_args()


async def main_async(args: argparse.Namespace) -> None:
    settings = load_settings(Path(args.env_file) if args.env_file else None)
    
    # Set up logging with file rotation in production
    log_file = None
    if settings.environment == "production":
        log_file = settings.database_path.parent / "logs" / "digestbot.log"
    
    setup_logging(
        level=settings.log_level,
        format_string=settings.log_format,
        log_file=log_file
    )

    db = Database(settings.database_path)
    await db.connect()

    summarizer = build_summarizer(
        settings.openrouter_api_key if settings.llm_active else None,
        settings.llm_model,
        settings.llm_max_output_tokens,
    )
    slack = SlackNotifier(settings.slack_bot_token, settings.slack_target_channel, settings.slack_post_enabled)
    digest_service = DigestService(db, summarizer, slack, settings)

    if args.command == "digest-once":
        await digest_service.run_digest()
        await db.close()
        return
    
    if args.command == "health-check":
        health_monitor = HealthMonitor(settings.database_path, settings)
        health_checks = await health_monitor.run_health_checks()
        
        print("Health Check Results:")
        print("=" * 50)
        for check in health_checks:
            status_icon = {
                "healthy": "✅",
                "warning": "⚠️",
                "critical": "❌",
                "unknown": "❓"
            }.get(check.status.value, "❓")
            
            print(f"{status_icon} {check.name}: {check.status.value}")
            if check.message:
                print(f"   {check.message}")
            if check.duration_ms:
                print(f"   Duration: {check.duration_ms}ms")
            print()
        
        overall_status = health_monitor.get_overall_status()
        print(f"Overall Status: {overall_status.value}")
        
        await db.close()
        return

    scheduler = DigestScheduler(digest_service, settings)
    await scheduler.start()

    loop = asyncio.get_running_loop()
    shutdown_event = asyncio.Event()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, shutdown_event.set)
        except (NotImplementedError, ValueError):
            # Windows or restricted environments
            pass

    discord_client: DiscordIngestor | None = None
    discord_task: asyncio.Task[None] | None = None

    if settings.discord_enabled:
        discord_client = DiscordIngestor(db, settings)
        discord_task = asyncio.create_task(discord_client.start(settings.discord_bot_token))  # type: ignore[arg-type]
    else:
        logger.warning("Discord token not provided; scheduler will run without live ingestion")

    async def wait_for_shutdown() -> None:
        waiters = [asyncio.create_task(shutdown_event.wait())]
        if discord_task:
            waiters.append(discord_task)
        try:
            done, pending = await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
            if discord_task and discord_task in done:
                exc = discord_task.exception()
                if exc:
                    logger.exception("Discord client stopped unexpectedly")
                    shutdown_event.set()
                    raise exc
                logger.warning("Discord client exited; shutting down")
                shutdown_event.set()
        finally:
            for task in waiters:
                if task.done():
                    continue
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    try:
        await wait_for_shutdown()
    except KeyboardInterrupt:
        logger.info("Shutdown requested via keyboard interrupt")
        shutdown_event.set()
    finally:
        if discord_client:
            await discord_client.close()
            if discord_task:
                with contextlib.suppress(asyncio.CancelledError):
                    await discord_task
        await scheduler.shutdown()
        await db.close()


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        logger.info("Interrupted")


if __name__ == "__main__":
    main()
