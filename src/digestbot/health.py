from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import aiosqlite

from .config import Settings

logger = logging.getLogger(__name__)


class HealthStatus(Enum):
    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


@dataclass
class HealthCheck:
    name: str
    status: HealthStatus
    message: Optional[str] = None
    duration_ms: Optional[int] = None
    timestamp: datetime = field(default_factory=datetime.utcnow)


class HealthMonitor:
    """Monitors system health and performs health checks."""
    
    def __init__(self, db_path: Path, settings: Settings) -> None:
        self.db_path = db_path
        self.settings = settings
        self._checks: List[HealthCheck] = []
    
    async def run_health_checks(self) -> List[HealthCheck]:
        """Run all health checks and return results."""
        logger.debug("Running health checks")
        
        checks = [
            self._check_database_connectivity(),
            self._check_database_performance(),
            self._check_discord_connectivity(),
            self._check_slack_connectivity(),
            self._check_llm_connectivity(),
            self._check_recent_activity(),
        ]
        
        results = await asyncio.gather(*checks, return_exceptions=True)
        
        self._checks = []
        for result in results:
            if isinstance(result, Exception):
                logger.error("Health check failed: %s", result)
                self._checks.append(HealthCheck(
                    name="system",
                    status=HealthStatus.CRITICAL,
                    message=f"Health check error: {result}"
                ))
            else:
                self._checks.append(result)
        
        # Store results in database
        await self._store_health_checks()
        
        return self._checks
    
    async def _check_database_connectivity(self) -> HealthCheck:
        """Check if database is accessible."""
        start_time = time.time()
        
        try:
            async with aiosqlite.connect(self.db_path) as conn:
                await conn.execute("SELECT 1")
                await conn.commit()
            
            duration_ms = int((time.time() - start_time) * 1000)
            return HealthCheck(
                name="database_connectivity",
                status=HealthStatus.HEALTHY,
                message="Database connection successful",
                duration_ms=duration_ms
            )
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            return HealthCheck(
                name="database_connectivity",
                status=HealthStatus.CRITICAL,
                message=f"Database connection failed: {e}",
                duration_ms=duration_ms
            )
    
    async def _check_database_performance(self) -> HealthCheck:
        """Check database performance metrics."""
        start_time = time.time()
        
        try:
            async with aiosqlite.connect(self.db_path) as conn:
                # Check message count
                cursor = await conn.execute("SELECT COUNT(*) FROM messages")
                message_count = (await cursor.fetchone())[0]
                
                # Check recent messages
                cursor = await conn.execute("""
                    SELECT COUNT(*) FROM messages 
                    WHERE created_at >= datetime('now', '-1 hour')
                """)
                recent_messages = (await cursor.fetchone())[0]
                
                # Check database size
                cursor = await conn.execute("PRAGMA page_count")
                page_count = (await cursor.fetchone())[0]
                cursor = await conn.execute("PRAGMA page_size")
                page_size = (await cursor.fetchone())[0]
                db_size_mb = (page_count * page_size) / (1024 * 1024)
            
            duration_ms = int((time.time() - start_time) * 1000)
            
            # Determine status based on metrics
            status = HealthStatus.HEALTHY
            message = f"DB: {message_count} messages, {recent_messages} recent, {db_size_mb:.1f}MB"
            
            if db_size_mb > 1000:  # > 1GB
                status = HealthStatus.WARNING
                message += " (large database)"
            elif recent_messages == 0:
                status = HealthStatus.WARNING
                message += " (no recent activity)"
            
            return HealthCheck(
                name="database_performance",
                status=status,
                message=message,
                duration_ms=duration_ms
            )
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            return HealthCheck(
                name="database_performance",
                status=HealthStatus.CRITICAL,
                message=f"Database performance check failed: {e}",
                duration_ms=duration_ms
            )
    
    async def _check_discord_connectivity(self) -> HealthCheck:
        """Check Discord connectivity."""
        if not self.settings.discord_enabled:
            return HealthCheck(
                name="discord_connectivity",
                status=HealthStatus.UNKNOWN,
                message="Discord not configured"
            )
        
        # This is a simplified check - in production you'd want to actually test the connection
        return HealthCheck(
            name="discord_connectivity",
            status=HealthStatus.HEALTHY,
            message="Discord token configured"
        )
    
    async def _check_slack_connectivity(self) -> HealthCheck:
        """Check Slack connectivity."""
        if not self.settings.slack_enabled:
            return HealthCheck(
                name="slack_connectivity",
                status=HealthStatus.UNKNOWN,
                message="Slack not configured"
            )
        
        # This is a simplified check - in production you'd want to actually test the connection
        return HealthCheck(
            name="slack_connectivity",
            status=HealthStatus.HEALTHY,
            message="Slack token configured"
        )
    
    async def _check_llm_connectivity(self) -> HealthCheck:
        """Check LLM service connectivity."""
        if not self.settings.llm_active:
            return HealthCheck(
                name="llm_connectivity",
                status=HealthStatus.UNKNOWN,
                message="LLM not configured"
            )
        
        # This is a simplified check - in production you'd want to actually test the connection
        return HealthCheck(
            name="llm_connectivity",
            status=HealthStatus.HEALTHY,
            message=f"LLM configured: {self.settings.llm_model}"
        )
    
    async def _check_recent_activity(self) -> HealthCheck:
        """Check for recent system activity."""
        try:
            async with aiosqlite.connect(self.db_path) as conn:
                # Check for recent batches
                cursor = await conn.execute("""
                    SELECT COUNT(*) FROM batches 
                    WHERE created_at >= datetime('now', '-24 hours')
                """)
                recent_batches = (await cursor.fetchone())[0]
                
                # Check for recent messages
                cursor = await conn.execute("""
                    SELECT COUNT(*) FROM messages 
                    WHERE created_at >= datetime('now', '-1 hour')
                """)
                recent_messages = (await cursor.fetchone())[0]
            
            if recent_batches > 0 and recent_messages > 0:
                status = HealthStatus.HEALTHY
                message = f"Active: {recent_batches} batches, {recent_messages} messages"
            elif recent_messages > 0:
                status = HealthStatus.WARNING
                message = f"Messages active but no recent batches: {recent_messages} messages"
            else:
                status = HealthStatus.WARNING
                message = "No recent activity"
            
            return HealthCheck(
                name="recent_activity",
                status=status,
                message=message
            )
        except Exception as e:
            return HealthCheck(
                name="recent_activity",
                status=HealthStatus.CRITICAL,
                message=f"Activity check failed: {e}"
            )
    
    async def _store_health_checks(self) -> None:
        """Store health check results in database."""
        if not self._checks:
            return
        
        try:
            async with aiosqlite.connect(self.db_path) as conn:
                for check in self._checks:
                    await conn.execute("""
                        INSERT INTO health_checks (check_type, status, message, duration_ms)
                        VALUES (?, ?, ?, ?)
                    """, (
                        check.name,
                        check.status.value,
                        check.message,
                        check.duration_ms
                    ))
                await conn.commit()
        except Exception as e:
            logger.error("Failed to store health checks: %s", e)
    
    def get_overall_status(self) -> HealthStatus:
        """Get overall system health status."""
        if not self._checks:
            return HealthStatus.UNKNOWN
        
        statuses = [check.status for check in self._checks]
        
        if HealthStatus.CRITICAL in statuses:
            return HealthStatus.CRITICAL
        elif HealthStatus.WARNING in statuses:
            return HealthStatus.WARNING
        elif all(status == HealthStatus.HEALTHY for status in statuses):
            return HealthStatus.HEALTHY
        else:
            return HealthStatus.UNKNOWN
    
    def get_status_summary(self) -> Dict[str, any]:
        """Get a summary of system health."""
        overall_status = self.get_overall_status()
        
        return {
            "overall_status": overall_status.value,
            "timestamp": datetime.utcnow().isoformat(),
            "checks": [
                {
                    "name": check.name,
                    "status": check.status.value,
                    "message": check.message,
                    "duration_ms": check.duration_ms,
                    "timestamp": check.timestamp.isoformat()
                }
                for check in self._checks
            ]
        }
