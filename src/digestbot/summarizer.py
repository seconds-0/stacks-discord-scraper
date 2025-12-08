from __future__ import annotations

import asyncio
import json
import logging
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Tuple

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency during tests
    OpenAI = None

from .models import ChannelDigest, DigestResult, Finding, MessageRecord


logger = logging.getLogger(__name__)


KEYWORDS_FEATURE = {"feature", "request", "suggest", "could you"}
KEYWORDS_BUG = {"bug", "broken", "error", "issue", "crash", "doesn't work", "fails"}
KEYWORDS_UNRESOLVED = {"any update", "still waiting", "help", "anyone", "stuck"}

TOP_WORD_COUNT = 3
TOP_CHANNEL_SUMMARY_COUNT = 5


class BaseSummarizer:
    async def summarize(
        self,
        window_start: datetime,
        window_end: datetime,
        channel_messages: Dict[int, List[MessageRecord]],
    ) -> Tuple[List[ChannelDigest], List[str], List[Finding]]:
        raise NotImplementedError


def _truncate(text: str, length: int = 140) -> str:
    text = text.strip().replace("\n", " ")
    return text if len(text) <= length else text[: length - 1] + "…"


def _detect_findings(
    channel_id: int,
    channel_name: str,
    server_id: int,
    server_name: str,
    messages: List[MessageRecord],
) -> Tuple[List[Finding], List[Finding], List[Finding]]:
    feature: List[Finding] = []
    bugs: List[Finding] = []
    unresolved: List[Finding] = []
    for msg in messages:
        content = (msg.content or "").lower()
        if not content:
            continue
        tags: List[str] = []
        if any(kw in content for kw in KEYWORDS_FEATURE):
            tags.append("feature")
            feature.append(
                Finding(
                    finding_type="feature_request",
                    title=_truncate(msg.content, 80) or "Feature idea",
                    description=msg.content.strip(),
                    message_ids=[msg.message_id],
                    channel_id=channel_id,
                    channel_name=channel_name,
                    server_id=server_id,
                    server_name=server_name,
                    confidence=0.4,
                    tags=tags.copy(),
                )
            )
        if any(kw in content for kw in KEYWORDS_BUG):
            tags.append("bug")
            bugs.append(
                Finding(
                    finding_type="bug",
                    title=_truncate(msg.content, 80) or "Bug report",
                    description=msg.content.strip(),
                    message_ids=[msg.message_id],
                    channel_id=channel_id,
                    channel_name=channel_name,
                    server_id=server_id,
                    server_name=server_name,
                    severity="medium",
                    confidence=0.4,
                    tags=tags.copy(),
                )
            )
        if any(kw in content for kw in KEYWORDS_UNRESOLVED):
            tags.append("unresolved")
            unresolved.append(
                Finding(
                    finding_type="unresolved",
                    title=_truncate(msg.content, 80) or "Unresolved issue",
                    description=msg.content.strip(),
                    message_ids=[msg.message_id],
                    channel_id=channel_id,
                    channel_name=channel_name,
                    server_id=server_id,
                    server_name=server_name,
                    confidence=0.3,
                    tags=tags.copy(),
                )
            )
    return feature, bugs, unresolved


class HeuristicSummarizer(BaseSummarizer):
    async def summarize(
        self,
        window_start: datetime,
        window_end: datetime,
        channel_messages: Dict[int, List[MessageRecord]],
    ) -> Tuple[List[ChannelDigest], List[str], List[Finding]]:
        channel_digests: List[ChannelDigest] = []
        all_findings: List[Finding] = []

        total_by_channel = {
            channel_id: len(messages)
            for channel_id, messages in channel_messages.items()
        }
        authors_by_channel: Dict[int, set[int]] = {
            channel_id: {msg.author_id for msg in messages}
            for channel_id, messages in channel_messages.items()
        }

        for channel_id, messages in channel_messages.items():
            if not messages:
                continue
            channel_name = messages[0].channel_name
            server_id = messages[0].server_id
            server_name = messages[0].server_name
            feature, bugs, unresolved = _detect_findings(channel_id, channel_name, server_id, server_name, messages)
            all_findings.extend(feature + bugs + unresolved)

            top_words = Counter()
            for msg in messages:
                for token in (msg.content or "").lower().split():
                    if token.startswith("<") or token.startswith("http") or len(token) < 4:
                        continue
                    top_words[token.strip(".,!?")] += 1

            popular = ", ".join(word for word, _ in top_words.most_common(TOP_WORD_COUNT))
            bullet = f"{len(messages)} messages from {len(authors_by_channel[channel_id])} people."
            if popular:
                bullet += f" Frequent terms: {popular}."

            summary_bullets = [bullet]
            channel_digests.append(
                ChannelDigest(
                    channel_id=channel_id,
                    channel_name=channel_name,
                    server_id=server_id,
                    server_name=server_name,
                    summary_bullets=summary_bullets,
                    total_messages=len(messages),
                    feature_requests=feature,
                    bugs=bugs,
                    unresolved=unresolved,
                )
            )

        channel_digests.sort(key=lambda c: c.total_messages, reverse=True)

        global_summary: List[str] = []
        for digest in channel_digests[:TOP_CHANNEL_SUMMARY_COUNT]:
            flagged = len(digest.feature_requests) + len(digest.bugs) + len(digest.unresolved)
            global_summary.append(
                f"#{digest.channel_name}: {digest.total_messages} messages, {flagged} flagged items."
            )

        return channel_digests, global_summary, all_findings


class OpenAISummarizer(BaseSummarizer):
    def __init__(
        self,
        api_key: str,
        model: str,
        max_output_tokens: int,
        fallback: BaseSummarizer,
    ) -> None:
        if OpenAI is None:
            raise RuntimeError("openai package is not installed")
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1"
        )
        self.model = model
        self.max_output_tokens = max_output_tokens
        self.fallback = fallback

    async def summarize(
        self,
        window_start: datetime,
        window_end: datetime,
        channel_messages: Dict[int, List[MessageRecord]],
    ) -> Tuple[List[ChannelDigest], List[str], List[Finding]]:
        payload = {
            "window": {
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
            },
            "channels": [
                {
                    "id": channel_id,
                    "name": messages[0].channel_name,
                    "server_id": messages[0].server_id,
                    "server_name": messages[0].server_name,
                    "messages": [
                        {
                            "id": msg.message_id,
                            "author_id": msg.author_id,
                            "author": msg.author_name,
                            "content": msg.content,
                            "created_at": msg.created_at.isoformat(),
                            "is_reply": msg.is_reply,
                            "has_attachments": msg.has_attachments,
                        }
                        for msg in messages
                    ],
                }
                for channel_id, messages in channel_messages.items()
                if messages
            ],
        }

        if not payload["channels"]:
            return [], [], []

        schema = {
            "name": "digest_schema",
            "schema": {
                "type": "object",
                "properties": {
                    "global_summary": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "channels": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "integer"},
                                "name": {"type": "string"},
                                "server_id": {"type": "integer"},
                                "server_name": {"type": "string"},
                                "summary_bullets": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                                "feature_requests": {"type": "array"},
                                "bugs": {"type": "array"},
                                "unresolved": {"type": "array"},
                            },
                            "required": [
                                "id",
                                "name",
                                "server_id",
                                "server_name",
                                "summary_bullets",
                                "feature_requests",
                                "bugs",
                                "unresolved",
                            ],
                        },
                    },
                },
                "required": ["global_summary", "channels"],
            },
        }

        schema_description = json.dumps(schema["schema"], indent=2)

        messages = [
            {
                "role": "system",
                "content": f"""You are a product triage analyst. Analyze Discord messages and identify:
- Feature requests: user suggestions for new functionality
- Bugs: reported errors, crashes, or broken functionality
- Unresolved issues: unanswered questions, stuck users, pending problems

Return a JSON object matching this schema:
{schema_description}

For each finding, include:
- title: brief summary
- description: more details
- message_ids: array of Discord message IDs (integers)
- confidence: 0.0-1.0 score
- tags: relevant keywords

Provide 3-7 global summary bullets highlighting the most important activity.""",
            },
            {
                "role": "user",
                "content": json.dumps(payload),
            },
        ]

        try:
            response = await asyncio.to_thread(
                self.client.chat.completions.create,
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
                max_tokens=self.max_output_tokens,
            )
            content = response.choices[0].message.content
            if not content:
                logger.warning("OpenRouter response has no content; using fallback")
                raise ValueError("No content in response")

            # Strip markdown code fences if present
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            elif content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as e:
                logger.warning("Failed to parse JSON response: %s", e)
                logger.warning("Response content (first 1000 chars): %s", content[:1000])
                # Try to extract the error location
                error_pos = getattr(e, 'pos', None)
                if error_pos:
                    start = max(0, error_pos - 100)
                    end = min(len(content), error_pos + 100)
                    logger.warning("Error context: ...%s...", content[start:end])
                raise

            return self._convert_output(parsed)
        except Exception:
            logger.exception("Failed to summarize with OpenRouter; falling back to heuristics")
            return await self.fallback.summarize(window_start, window_end, channel_messages)

    def _convert_output(self, payload: dict) -> Tuple[List[ChannelDigest], List[str], List[Finding]]:
        channel_digests: List[ChannelDigest] = []
        all_findings: List[Finding] = []

        for item in payload.get("channels", []):
            channel_id = item.get("id")
            channel_name = item.get("name", "unknown")
            summary = item.get("summary_bullets", [])
            feature_raw = item.get("feature_requests", [])
            bug_raw = item.get("bugs", [])
            unresolved_raw = item.get("unresolved", [])
            server_id = item.get("server_id")
            server_name = item.get("server_name", "discord")

            feature = [self._finding_from_dict("feature_request", channel_id, channel_name, server_id, server_name, f) for f in feature_raw]
            bugs = [self._finding_from_dict("bug", channel_id, channel_name, server_id, server_name, f) for f in bug_raw]
            unresolved = [self._finding_from_dict("unresolved", channel_id, channel_name, server_id, server_name, f) for f in unresolved_raw]
            all_findings.extend(feature + bugs + unresolved)

            total_messages = item.get("total_messages") or 0
            channel_digests.append(
                ChannelDigest(
                    channel_id=channel_id,
                    channel_name=channel_name,
                    server_id=server_id,
                    server_name=server_name,
                    summary_bullets=summary,
                    total_messages=total_messages,
                    feature_requests=feature,
                    bugs=bugs,
                    unresolved=unresolved,
                )
            )

        global_summary = payload.get("global_summary", [])
        return channel_digests, global_summary, all_findings

    def _finding_from_dict(
        self,
        finding_type: str,
        channel_id: int,
        channel_name: str,
        server_id: int,
        server_name: str,
        data: dict,
    ) -> Finding:
        message_ids = data.get("message_ids") or []
        title = data.get("title") or finding_type.title()
        return Finding(
            finding_type=finding_type,
            title=title,
            description=data.get("description", ""),
            message_ids=message_ids,
            channel_id=channel_id,
            channel_name=channel_name,
            server_id=server_id,
            server_name=server_name,
            severity=data.get("severity"),
            confidence=float(data.get("confidence", 0.5)),
            tags=data.get("tags", []),
        )


def build_summarizer(openrouter_api_key: str | None, model: str, max_tokens: int) -> BaseSummarizer:
    heuristic = HeuristicSummarizer()
    if openrouter_api_key:
        try:
            return OpenAISummarizer(openrouter_api_key, model, max_tokens, heuristic)
        except Exception:
            logger.exception("Unable to initialize OpenRouter summarizer; using heuristic only")
    return heuristic


__all__ = [
    "BaseSummarizer",
    "HeuristicSummarizer",
    "OpenAISummarizer",
    "build_summarizer",
]
