"""Core interception pipeline: tool call in → InterceptedEvent published on bus."""
import asyncio
import logging

from .escalation import stream as stream_chat
from .escalation import twilio_call
from .event_bus import bus
from .policy import decide
from .ranker import rank
from .schemas import InterceptedEvent, Severity, ToolCall

log = logging.getLogger("sentinel.intercept")

# Severities that get fanned out to Stream chat. Medium is intentionally
# excluded: it's high-volume in the synthetic mix and would drown the channel.
# Engineers see medium events in the dashboard; Stream is for HIGH/CRITICAL.
STREAM_TIERS = {Severity.HIGH, Severity.CRITICAL}


async def intercept(call: ToolCall) -> InterceptedEvent:
    assessment = await rank(call)
    event = decide(call, assessment)
    await bus.publish(event)
    if event.severity in STREAM_TIERS and stream_chat.available():
        asyncio.create_task(stream_chat.post_incident(event.model_dump(mode="json")))
    if event.severity is Severity.CRITICAL and twilio_call.available():
        asyncio.create_task(twilio_call.place_call(event.model_dump(mode="json")))
    return event
