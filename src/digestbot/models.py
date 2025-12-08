from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional


@dataclass(slots=True)
class MessageRecord:
    message_id: int
    channel_id: int
    channel_name: str
    server_id: int
    server_name: str
    author_id: int
    author_name: str
    content: str
    created_at: datetime
    is_reply: bool
    parent_message_id: Optional[int]
    has_attachments: bool
    raw_json: str


@dataclass(slots=True)
class Finding:
    finding_type: str  # feature_request | bug | unresolved
    title: str
    description: str
    message_ids: List[int]
    channel_id: int
    channel_name: str
    server_id: int
    server_name: str
    severity: Optional[str] = None
    confidence: float = 0.0
    tags: List[str] = field(default_factory=list)


@dataclass(slots=True)
class ChannelDigest:
    channel_id: int
    channel_name: str
    server_id: int
    server_name: str
    summary_bullets: List[str]
    total_messages: int
    feature_requests: List[Finding] = field(default_factory=list)
    bugs: List[Finding] = field(default_factory=list)
    unresolved: List[Finding] = field(default_factory=list)


@dataclass(slots=True)
class DigestResult:
    window_start: datetime
    window_end: datetime
    channel_digests: List[ChannelDigest]
    global_summary: List[str]
    total_messages: int
