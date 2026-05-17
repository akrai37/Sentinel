"""Stream Chat integration — persistent incident channel.

For every MEDIUM+ event Sentinel posts a structured message into the
`#incidents` channel. The message carries the incident metadata in
`custom_data` so the frontend can render Release/Block/Escalate buttons.

Tokens for the browser are minted with `gen_user_token`.
"""
from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("sentinel.stream")

try:
    from stream_chat import StreamChat
except Exception:  # pragma: no cover
    StreamChat = None  # type: ignore[assignment]

CHANNEL_TYPE = "messaging"
CHANNEL_ID = "sentinel-incidents"
BOT_USER_ID = "sentinel-bot"
DEFAULT_VIEWER_ID = "oncall"

_client = None
_channel_ready = False


def _key_secret() -> tuple[str, str]:
    return os.environ.get("STREAM_API_KEY", ""), os.environ.get("STREAM_API_SECRET", "")


def available() -> bool:
    k, s = _key_secret()
    return bool(k and s and StreamChat is not None)


def public_key() -> str:
    return os.environ.get("STREAM_API_KEY", "")


def _get_client():
    global _client
    if _client is not None:
        return _client
    if not available():
        return None
    key, secret = _key_secret()
    _client = StreamChat(api_key=key, api_secret=secret)  # type: ignore[operator]
    return _client


async def _ensure_channel() -> None:
    global _channel_ready
    if _channel_ready:
        return
    client = _get_client()
    if client is None:
        return
    # Upsert the bot user, then create / update the channel
    client.upsert_user({"id": BOT_USER_ID, "name": "Sentinel", "role": "admin"})
    client.upsert_user({"id": DEFAULT_VIEWER_ID, "name": "On-call engineer"})
    ch = client.channel(
        CHANNEL_TYPE,
        CHANNEL_ID,
        data={"name": "Sentinel incidents", "members": [BOT_USER_ID, DEFAULT_VIEWER_ID]},
    )
    ch.create(BOT_USER_ID)
    _channel_ready = True


def gen_user_token(user_id: str = DEFAULT_VIEWER_ID) -> dict[str, Any]:
    """Mint a token the frontend can use to connect as `user_id`."""
    client = _get_client()
    if client is None:
        return {"error": "stream_unavailable"}
    client.upsert_user({"id": user_id, "name": user_id.replace("-", " ").title()})
    return {
        "api_key": public_key(),
        "user_id": user_id,
        "token": client.create_token(user_id),
        "channel_type": CHANNEL_TYPE,
        "channel_id": CHANNEL_ID,
    }


async def truncate_channel() -> bool:
    """Wipe all messages from the incidents channel (for clean demo starts)."""
    if not available():
        return False
    try:
        await _ensure_channel()
        client = _get_client()
        if client is None:
            return False
        ch = client.channel(CHANNEL_TYPE, CHANNEL_ID)
        ch.truncate()
        return True
    except Exception as exc:
        log.warning("stream truncate_channel failed: %s", exc)
        return False


async def post_escalation(incident_id: str, note: str = "") -> None:
    """Post a follow-up 'ESCALATED' message to the incidents channel."""
    if not available():
        return
    try:
        await _ensure_channel()
        client = _get_client()
        if client is None:
            return
        ch = client.channel(CHANNEL_TYPE, CHANNEL_ID)
        text = f"🚨 ESCALATED by on-call · needs second opinion · incident {incident_id}"
        if note:
            text += f"\n{note}"
        ch.send_message(
            {
                "text": text,
                "sentinel_incident_id": incident_id,
                "sentinel_escalation": True,
            },
            BOT_USER_ID,
        )
    except Exception as exc:
        log.warning("stream post_escalation failed: %s", exc)


async def post_incident(event: dict[str, Any]) -> None:
    """Post one intercepted-event card to the incidents channel."""
    if not available():
        return
    try:
        await _ensure_channel()
        client = _get_client()
        if client is None:
            return
        ch = client.channel(CHANNEL_TYPE, CHANNEL_ID)
        sev = event["severity"]
        emoji = {"medium": "⚠️", "high": "🟧", "critical": "🚨"}.get(sev, "•")
        text = (
            f"{emoji} {sev.upper()} — {event['call']['tool_name']} "
            f"by {event['call']['agent_id']}\n"
            f"{event['assessment']['rationale']}"
        )
        ch.send_message(
            {
                "text": text,
                "sentinel_incident_id": event["id"],
                "sentinel_severity": sev,
                "sentinel_category": event["assessment"]["category"],
                "sentinel_score": event["assessment"]["score"],
                "sentinel_tool": event["call"]["tool_name"],
                "sentinel_agent": event["call"]["agent_id"],
                "sentinel_args": event["call"]["arguments"],
                "sentinel_verdict": event["verdict"],
            },
            BOT_USER_ID,
        )
    except Exception as exc:
        log.warning("stream post_incident failed: %s", exc)
