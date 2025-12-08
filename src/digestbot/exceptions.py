from __future__ import annotations

from typing import Optional


class DigestBotError(Exception):
    """Base exception for DigestBot errors."""
    
    def __init__(self, message: str, details: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class ConfigurationError(DigestBotError):
    """Raised when there's a configuration issue."""
    pass


class DatabaseError(DigestBotError):
    """Raised when there's a database operation error."""
    pass


class DiscordError(DigestBotError):
    """Raised when there's a Discord API error."""
    pass


class SlackError(DigestBotError):
    """Raised when there's a Slack API error."""
    pass


class LLMError(DigestBotError):
    """Raised when there's an LLM API error."""
    pass


class SchedulerError(DigestBotError):
    """Raised when there's a scheduler error."""
    pass


class DigestError(DigestBotError):
    """Raised when there's a digest generation error."""
    pass
