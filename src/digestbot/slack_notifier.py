from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import List, Optional

try:
    from slack_sdk.errors import SlackApiError
    from slack_sdk.web.async_client import AsyncWebClient
except ImportError:  # pragma: no cover - optional
    AsyncWebClient = None  # type: ignore
    SlackApiError = Exception  # type: ignore

from .exceptions import SlackError
from .models import ChannelDigest, DigestResult, Finding
from .retry import retry_async, STANDARD_RETRY


logger = logging.getLogger(__name__)


TOP_CHANNEL_SECTION_LIMIT = 5
TOP_FINDINGS_LIMIT = 5


def _format_bullet_list(items: List[str]) -> str:
    return "\n".join(f"• {item}" for item in items if item)


class SlackNotifier:
    def __init__(self, token: Optional[str], channel: Optional[str], enabled: bool) -> None:
        self.channel = channel
        self.enabled = enabled and bool(token and channel)
        if self.enabled:
            if AsyncWebClient is None:
                raise RuntimeError("slack_sdk is not installed")
            self.client = AsyncWebClient(token=token)
        else:
            self.client = None

    @retry_async(config=STANDARD_RETRY, exceptions=(SlackApiError,))
    async def post_digest(self, digest: DigestResult, findings: List[Finding]) -> Optional[str]:
        blocks = self._build_blocks(digest, findings)

        if not self.enabled or self.client is None:
            logger.info("Slack disabled; digest blocks:\n%s", json.dumps(blocks, indent=2))
            return None

        text_preview = f"Discord digest {digest.window_start.date()} → {digest.window_end.date()}"
        try:
            response = await self.client.chat_postMessage(
                channel=self.channel,
                text=text_preview,
                blocks=blocks,
            )
            ts = response.get("ts") if isinstance(response, dict) else None
            logger.info("Posted Slack digest message ts=%s", ts)
            return ts
        except SlackApiError as e:
            logger.error("Failed to post digest to Slack: %s", e)
            raise SlackError(f"Failed to post digest to Slack: {e}", details=str(e))

    def _build_blocks(self, digest: DigestResult, findings: List[Finding]) -> List[dict]:
        start_local = digest.window_start
        end_local = digest.window_end

        header = {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"Discord Highlights — {end_local.strftime('%b %d, %Y')}",
            },
        }

        context = {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"*Window:* {start_local.isoformat()} → {end_local.isoformat()}",
                },
                {
                    "type": "mrkdwn",
                    "text": f"*Messages:* {digest.total_messages}",
                },
            ],
        }

        blocks: List[dict] = [header, context, {"type": "divider"}]

        if digest.global_summary:
            blocks.append(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*Highlights*\n" + _format_bullet_list(digest.global_summary),
                    },
                }
            )

        blocks.extend(self._build_channel_sections(digest.channel_digests))
        blocks.extend(self._build_finding_sections(findings))

        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": "Generated via daily Discord ingestion."}]})
        return blocks

    def _build_channel_sections(self, channel_digests: List[ChannelDigest]) -> List[dict]:
        sections: List[dict] = []
        for digest in channel_digests[:TOP_CHANNEL_SECTION_LIMIT]:
            text_lines = [f"*#{digest.channel_name}* — {digest.total_messages} messages"]
            text_lines.extend(digest.summary_bullets)
            sections.append(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "\n".join(text_lines),
                    },
                }
            )
        if sections:
            sections.insert(0, {"type": "divider"})
        return sections

    def _build_finding_sections(self, findings: List[Finding]) -> List[dict]:
        if not findings:
            return []
        by_type: dict[str, List[Finding]] = {"feature_request": [], "bug": [], "unresolved": []}
        for finding in findings:
            by_type.setdefault(finding.finding_type, []).append(finding)

        sections: List[dict] = []
        mapping = [
            ("feature_request", "Feature Requests"),
            ("bug", "Bugs"),
            ("unresolved", "Unresolved"),
        ]
        for key, title in mapping:
            items = by_type.get(key) or []
            if not items:
                continue
            items = sorted(items, key=lambda f: f.confidence, reverse=True)[:TOP_FINDINGS_LIMIT]
            bullet_lines: List[str] = []
            for finding in items:
                permalink = self._permalink(finding)
                msg_link = f"<{permalink}|View>" if permalink else ""
                bullet = f"*#{finding.channel_name}* — {finding.title}"
                if msg_link:
                    bullet += f" {msg_link}"
                if finding.confidence:
                    bullet += f" _(confidence {finding.confidence:.0%})_"
                bullet_lines.append(bullet)

            sections.append({"type": "divider"})
            sections.append(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{title}*\n" + _format_bullet_list(bullet_lines),
                    },
                }
            )
        return sections

    def _permalink(self, finding: Finding) -> Optional[str]:
        if not finding.message_ids:
            return None
        return f"https://discord.com/channels/{finding.server_id}/{finding.channel_id}/{finding.message_ids[0]}"


__all__ = ["SlackNotifier"]
