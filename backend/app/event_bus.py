"""In-memory pub/sub for streaming intercepted events to dashboard clients."""
import asyncio
from collections import deque
from typing import AsyncIterator

from .schemas import InterceptedEvent


class EventBus:
    def __init__(self, history_size: int = 500) -> None:
        self._subscribers: set[asyncio.Queue[InterceptedEvent]] = set()
        self._history: deque[InterceptedEvent] = deque(maxlen=history_size)

    def history(self) -> list[InterceptedEvent]:
        return list(self._history)

    async def publish(self, event: InterceptedEvent) -> None:
        self._history.append(event)
        for q in list(self._subscribers):
            await q.put(event)

    async def subscribe(self) -> AsyncIterator[InterceptedEvent]:
        q: asyncio.Queue[InterceptedEvent] = asyncio.Queue()
        self._subscribers.add(q)
        try:
            for past in self._history:
                yield past
            while True:
                yield await q.get()
        finally:
            self._subscribers.discard(q)


bus = EventBus()
