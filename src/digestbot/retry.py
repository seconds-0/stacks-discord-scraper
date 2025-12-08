from __future__ import annotations

import asyncio
import logging
import random
from functools import wraps
from typing import Any, Awaitable, Callable, Optional, Type, Union

from .exceptions import DigestBotError

logger = logging.getLogger(__name__)


class RetryConfig:
    """Configuration for retry behavior."""
    
    def __init__(
        self,
        max_attempts: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0,
        exponential_base: float = 2.0,
        jitter: bool = True,
        backoff_factor: float = 1.0,
    ) -> None:
        self.max_attempts = max_attempts
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter
        self.backoff_factor = backoff_factor


def retry_async(
    config: Optional[RetryConfig] = None,
    exceptions: tuple[Type[Exception], ...] = (Exception,),
    on_retry: Optional[Callable[[Exception, int], None]] = None,
) -> Callable:
    """Decorator for retrying async functions with exponential backoff."""
    
    if config is None:
        config = RetryConfig()
    
    def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception: Optional[Exception] = None
            
            for attempt in range(config.max_attempts):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    
                    if attempt == config.max_attempts - 1:
                        # Last attempt, re-raise the exception
                        logger.error(
                            "Function %s failed after %d attempts: %s",
                            func.__name__,
                            config.max_attempts,
                            e
                        )
                        raise
                    
                    # Calculate delay with exponential backoff
                    delay = min(
                        config.base_delay * (config.exponential_base ** attempt) * config.backoff_factor,
                        config.max_delay
                    )
                    
                    # Add jitter to prevent thundering herd
                    if config.jitter:
                        delay *= (0.5 + random.random() * 0.5)
                    
                    logger.warning(
                        "Function %s failed (attempt %d/%d): %s. Retrying in %.2f seconds",
                        func.__name__,
                        attempt + 1,
                        config.max_attempts,
                        e,
                        delay
                    )
                    
                    if on_retry:
                        on_retry(e, attempt + 1)
                    
                    await asyncio.sleep(delay)
            
            # This should never be reached, but just in case
            if last_exception:
                raise last_exception
            
            raise RuntimeError("Retry logic failed unexpectedly")
        
        return wrapper
    return decorator


def retry_sync(
    config: Optional[RetryConfig] = None,
    exceptions: tuple[Type[Exception], ...] = (Exception,),
    on_retry: Optional[Callable[[Exception, int], None]] = None,
) -> Callable:
    """Decorator for retrying sync functions with exponential backoff."""
    
    if config is None:
        config = RetryConfig()
    
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception: Optional[Exception] = None
            
            for attempt in range(config.max_attempts):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    
                    if attempt == config.max_attempts - 1:
                        # Last attempt, re-raise the exception
                        logger.error(
                            "Function %s failed after %d attempts: %s",
                            func.__name__,
                            config.max_attempts,
                            e
                        )
                        raise
                    
                    # Calculate delay with exponential backoff
                    delay = min(
                        config.base_delay * (config.exponential_base ** attempt) * config.backoff_factor,
                        config.max_delay
                    )
                    
                    # Add jitter to prevent thundering herd
                    if config.jitter:
                        delay *= (0.5 + random.random() * 0.5)
                    
                    logger.warning(
                        "Function %s failed (attempt %d/%d): %s. Retrying in %.2f seconds",
                        func.__name__,
                        attempt + 1,
                        config.max_attempts,
                        e,
                        delay
                    )
                    
                    if on_retry:
                        on_retry(e, attempt + 1)
                    
                    import time
                    time.sleep(delay)
            
            # This should never be reached, but just in case
            if last_exception:
                raise last_exception
            
            raise RuntimeError("Retry logic failed unexpectedly")
        
        return wrapper
    return decorator


# Common retry configurations
QUICK_RETRY = RetryConfig(max_attempts=3, base_delay=0.5, max_delay=5.0)
STANDARD_RETRY = RetryConfig(max_attempts=3, base_delay=1.0, max_delay=30.0)
LONG_RETRY = RetryConfig(max_attempts=5, base_delay=2.0, max_delay=120.0)
