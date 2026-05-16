"""Core interception pipeline: tool call in → InterceptedEvent published on bus."""
from .event_bus import bus
from .policy import decide
from .ranker import rank
from .schemas import InterceptedEvent, ToolCall


async def intercept(call: ToolCall) -> InterceptedEvent:
    assessment = await rank(call)
    event = decide(call, assessment)
    await bus.publish(event)
    return event
