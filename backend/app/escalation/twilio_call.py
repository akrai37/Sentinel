"""Twilio outbound call for critical incidents.

When a CRITICAL event fires, Sentinel places a real phone call to the on-call
engineer via Twilio. The call uses inline TwiML — no webhook required, so we
don't need to expose a public URL during the hackathon demo.

Trial accounts can only call **verified** numbers. Configure
`TWILIO_ONCALL_NUMBER` to a number you've added in
Phone Numbers → Verified Caller IDs.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

log = logging.getLogger("sentinel.twilio")

try:
    from twilio.rest import Client
    from twilio.twiml.voice_response import VoiceResponse
except Exception:  # pragma: no cover
    Client = None  # type: ignore[assignment]
    VoiceResponse = None  # type: ignore[assignment]


def _env() -> tuple[str, str, str, str]:
    return (
        os.environ.get("TWILIO_ACCOUNT_SID", ""),
        os.environ.get("TWILIO_AUTH_TOKEN", ""),
        os.environ.get("TWILIO_FROM_NUMBER", ""),
        os.environ.get("TWILIO_ONCALL_NUMBER", ""),
    )


def available() -> bool:
    sid, token, frm, to = _env()
    return bool(sid and token and frm and to and Client is not None)


def status() -> dict[str, Any]:
    sid, _, frm, to = _env()
    return {
        "available": available(),
        "from_number": frm or None,
        "oncall_number": to or None,
        "account_sid_prefix": (sid[:6] + "…") if sid else None,
    }


_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    sid, token, _, _ = _env()
    if not (sid and token and Client is not None):
        return None
    _client = Client(sid, token)
    return _client


def _twiml_for(event: dict[str, Any]) -> str:
    """Build inline TwiML that speaks the incident brief."""
    tool = event["call"]["tool_name"]
    agent = event["call"]["agent_id"]
    rationale = event["assessment"]["rationale"]
    text = (
        "This is Sentinel calling. Critical incident. "
        f"Agent {agent} attempted {tool}. "
        f"{rationale}. The action was auto-blocked. "
        "Please open your dashboard or the war room to release or escalate."
    )
    resp = VoiceResponse()
    resp.pause(length=1)
    resp.say(text, voice="alice", rate="0.95")
    resp.pause(length=1)
    resp.say("Goodbye.", voice="alice")
    return str(resp)


def _place_call_sync(event: dict[str, Any]) -> dict[str, Any]:
    client = _get_client()
    sid, _, frm, to = _env()
    if client is None or not (frm and to):
        return {"placed": False, "error": "twilio_unavailable"}
    try:
        call = client.calls.create(
            to=to,
            from_=frm,
            twiml=_twiml_for(event),
        )
        return {"placed": True, "call_sid": call.sid, "to": to}
    except Exception as exc:
        log.warning("twilio call failed: %s", exc)
        return {"placed": False, "error": str(exc)}


async def place_call(event: dict[str, Any]) -> dict[str, Any]:
    """Place an outbound call. Runs blocking SDK call in a worker thread."""
    if not available():
        return {"placed": False, "error": "twilio_unavailable"}
    return await asyncio.to_thread(_place_call_sync, event)
