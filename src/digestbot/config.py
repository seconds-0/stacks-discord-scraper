"""Configuration management for DigestBot.

This module provides centralized configuration management using environment variables
and dataclasses for type safety and validation.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Set
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


def _as_bool(value: Optional[str], default: bool) -> bool:
    """Convert string value to boolean.

    Args:
        value: String value to convert
        default: Default value if conversion fails

    Returns:
        Boolean value
    """
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(value: Optional[str], default: int) -> int:
    """Convert string value to integer.

    Args:
        value: String value to convert
        default: Default value if conversion fails

    Returns:
        Integer value

    Raises:
        ValueError: If conversion fails
    """
    if value is None or value.strip() == "":
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"Invalid integer value: {value}") from exc


def _as_id_set(value: Optional[str]) -> Set[int]:
    """Convert comma-separated string to set of integers.

    Args:
        value: Comma-separated string of IDs

    Returns:
        Set of integer IDs

    Raises:
        ValueError: If any ID cannot be converted to integer
    """
    if not value:
        return set()
    ids: Set[int] = set()
    for chunk in value.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        ids.add(int(chunk))
    return ids


@dataclass(slots=True)
class Settings:
    """Application settings loaded from environment variables.

    This class provides type-safe access to all configuration settings
    with validation and sensible defaults.
    """
    # Environment
    environment: str = "development"

    # Discord Configuration
    discord_bot_token: Optional[str] = field(default=None, repr=False)
    discord_channel_allowlist: Set[int] = field(default_factory=set)
    discord_channel_denylist: Set[int] = field(default_factory=set)
    discord_initial_backfill_limit: int = 500

    # Slack Configuration
    slack_bot_token: Optional[str] = None
    slack_target_channel: Optional[str] = None
    slack_post_enabled: bool = True

    # LLM Configuration
    openrouter_api_key: Optional[str] = field(default=None, repr=False)
    llm_model: str = "openai/gpt-4o-mini"
    llm_enabled: bool = True
    llm_max_output_tokens: int = 2000

    # Scheduling Configuration
    timezone: ZoneInfo = field(default_factory=lambda: ZoneInfo("America/Los_Angeles"))
    digest_cron: str = "0 5 * * *"
    digest_run_on_start: bool = True
    digest_window_hours: int = 24

    # Database Configuration
    database_path: Path = field(default_factory=lambda: Path("data/app.db"))

    # Logging Configuration
    log_level: str = "INFO"
    log_format: str = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"

    def __post_init__(self) -> None:
        if self.discord_initial_backfill_limit <= 0:
            raise ValueError("DISCORD_INITIAL_BACKFILL_LIMIT must be greater than zero")
        if self.llm_max_output_tokens <= 0:
            raise ValueError("LLM_MAX_OUTPUT_TOKENS must be greater than zero")
        if self.digest_window_hours <= 0:
            raise ValueError("DIGEST_WINDOW_HOURS must be greater than zero")
        if self.discord_channel_allowlist and self.discord_channel_denylist:
            overlap = self.discord_channel_allowlist & self.discord_channel_denylist
            if overlap:
                raise ValueError(f"Channels present in both allowlist and denylist: {overlap}")

    @property
    def discord_enabled(self) -> bool:
        """Check if Discord integration is enabled.

        Returns:
            True if Discord bot token is configured
        """
        return bool(self.discord_bot_token)

    @property
    def slack_enabled(self) -> bool:
        """Check if Slack integration is enabled.

        Returns:
            True if Slack posting is enabled and bot token/channel are configured
        """
        return self.slack_post_enabled and bool(self.slack_bot_token and self.slack_target_channel)

    @property
    def llm_active(self) -> bool:
        """Check if LLM integration is active.

        Returns:
            True if LLM is enabled and API key is configured
        """
        return self.llm_enabled and bool(self.openrouter_api_key)


def load_settings(env_file: Optional[Path] = None) -> Settings:
    """Load application settings from environment variables.

    Args:
        env_file: Optional path to .env file

    Returns:
        Settings instance with loaded configuration

    Raises:
        ValueError: If configuration validation fails
    """
    load_dotenv(env_file)

    # Environment
    environment = os.getenv("ENVIRONMENT", "development")

    # Discord Configuration
    discord_bot_token = os.getenv("DISCORD_BOT_TOKEN")
    allowlist = _as_id_set(os.getenv("DISCORD_CHANNEL_ALLOWLIST"))
    denylist = _as_id_set(os.getenv("DISCORD_CHANNEL_DENYLIST"))
    backfill_limit = _as_int(os.getenv("DISCORD_INITIAL_BACKFILL_LIMIT"), 500)

    # Slack Configuration
    slack_bot_token = os.getenv("SLACK_BOT_TOKEN")
    slack_channel = os.getenv("SLACK_TARGET_CHANNEL")
    slack_post_enabled = _as_bool(os.getenv("SLACK_POST_ENABLED"), True)

    # LLM Configuration
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    llm_model = os.getenv("LLM_MODEL", "openai/gpt-4o-mini")
    llm_enabled = _as_bool(os.getenv("LLM_ENABLED"), True)
    llm_max_tokens = _as_int(os.getenv("LLM_MAX_OUTPUT_TOKENS"), 2000)

    # Scheduling Configuration
    timezone_name = os.getenv("TIMEZONE", "America/Los_Angeles")
    tz = ZoneInfo(timezone_name)
    digest_cron = os.getenv("DIGEST_CRON", "0 5 * * *")
    digest_run_on_start = _as_bool(os.getenv("DIGEST_RUN_ON_START"), True)
    digest_window_hours = _as_int(os.getenv("DIGEST_WINDOW_HOURS"), 24)

    # Database Configuration
    db_path = Path(os.getenv("DATABASE_PATH", "data/app.db"))

    # Logging Configuration
    log_level = os.getenv("LOG_LEVEL", "INFO")
    log_format = os.getenv("LOG_FORMAT", "%(asctime)s | %(levelname)s | %(name)s | %(message)s")

    settings = Settings(
        environment=environment,
        discord_bot_token=discord_bot_token,
        discord_channel_allowlist=allowlist,
        discord_channel_denylist=denylist,
        discord_initial_backfill_limit=backfill_limit,
        slack_bot_token=slack_bot_token,
        slack_target_channel=slack_channel,
        slack_post_enabled=slack_post_enabled,
        openrouter_api_key=openrouter_api_key,
        llm_model=llm_model,
        llm_enabled=llm_enabled,
        llm_max_output_tokens=llm_max_tokens,
        timezone=tz,
        digest_cron=digest_cron,
        digest_run_on_start=digest_run_on_start,
        digest_window_hours=digest_window_hours,
        database_path=db_path,
        log_level=log_level,
        log_format=log_format,
    )

    return settings
