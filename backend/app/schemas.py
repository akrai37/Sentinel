from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _id() -> str:
    return uuid4().hex[:12]


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Verdict(str, Enum):
    ALLOW = "allow"
    BLOCK = "block"
    PENDING_HUMAN = "pending_human"


class ToolCall(BaseModel):
    """A single agent tool invocation observed by the proxy."""
    id: str = Field(default_factory=_id)
    agent_id: str
    tool_name: str
    arguments: dict[str, Any]
    received_at: datetime = Field(default_factory=_now)


class ThreatAssessment(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    category: str
    rationale: str
    matched_rules: list[str] = Field(default_factory=list)


class InterceptedEvent(BaseModel):
    """An intercepted tool call after classification + policy."""
    id: str = Field(default_factory=_id)
    call: ToolCall
    assessment: ThreatAssessment
    severity: Severity
    verdict: Verdict
    decided_at: datetime = Field(default_factory=_now)
    escalation_channel: Literal["none", "stream", "voiceos"] = "none"
    human_decision: Literal["pending", "release", "keep_blocked", "approve", "deny"] | None = None
