"use client";
import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";
import type { InterceptedEvent } from "./types";

const MAX_EVENTS = 200;

export function useEventStream(): {
  events: InterceptedEvent[];
  connected: boolean;
} {
  const [events, setEvents] = useState<InterceptedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events/stream`);
    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("intercepted", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as InterceptedEvent;
      if (seenIds.current.has(ev.id)) return;
      seenIds.current.add(ev.id);
      setEvents((prev) => [ev, ...prev].slice(0, MAX_EVENTS));
    });
    return () => es.close();
  }, []);

  return { events, connected };
}
