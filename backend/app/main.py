"""Sentinel backend entrypoint.

Phase 0 surface:
  GET  /health                 — liveness
  GET  /api/events             — current event history (JSON)
  GET  /api/events/stream      — SSE live feed of intercepted events
  POST /api/intercept          — push a raw tool call through the pipeline
  POST /api/demo/attack        — fire the cinematic critical-tier demo event
  POST /api/demo/traffic/start — start synthetic background traffic
  POST /api/demo/traffic/stop  — stop synthetic background traffic
"""
import asyncio
import json
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # populate env from backend/.env before module imports run

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from . import llm_classifier
from .cisco import advisor as cisco_advisor
from .cisco import data as cisco_data
from .data.synthetic_traces import emit_demo_attack, stream_traces
from .escalation import stream as stream_chat
from .escalation import trtc
from .escalation import twilio_call
from .eval.harness import run as run_eval
from .event_bus import bus
from .interceptor import intercept
from .schemas import InterceptedEvent, ToolCall


class TrafficController:
    def __init__(self) -> None:
        self.task: asyncio.Task | None = None

    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def start(self) -> None:
        if not self.running():
            self.task = asyncio.create_task(stream_traces())

    def stop(self) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
            self.task = None


traffic = TrafficController()


@asynccontextmanager
async def lifespan(_: FastAPI):
    traffic.start()
    try:
        yield
    finally:
        traffic.stop()


app = FastAPI(title="Sentinel", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "traffic_running": traffic.running()}


@app.get("/api/stats")
async def stats() -> dict:
    return {
        "traffic_running": traffic.running(),
        "events_seen": len(bus.history()),
        "llm": {
            "available": llm_classifier.available(),
            "model": llm_classifier.MODEL,
            "cache_size": llm_classifier.cache_size(),
        },
        "trtc": {"available": trtc.available()},
        "stream": {"available": stream_chat.available()},
        "twilio": twilio_call.status(),
        "cisco": {
            "available": cisco_data.available(),
            "scenarios": len(cisco_data.scenarios()) if cisco_data.available() else 0,
        },
    }


@app.get("/api/cisco/scenarios")
async def list_cisco_scenarios() -> list[dict]:
    """List Cisco AI-Factory scenarios with their summary signals."""
    if not cisco_data.available():
        return []
    out = []
    summaries = cisco_data.scenario_summary()
    for s in cisco_data.scenarios():
        sid = s["scenario_id"]
        sm = summaries.get(sid, {})
        out.append({
            "scenario_id": sid,
            "track_id": s["track_id"],
            "focus_entity": s.get("focus_entity"),
            "prompt": s.get("prompt"),
            "window": [s["start_time"], s["end_time"]],
            "critical_alerts": int(sm.get("critical_alerts") or 0),
            "top_alert_types": sm.get("top_alert_types") or "",
        })
    return out


@app.post("/api/cisco/evaluate/{scenario_id}")
async def evaluate_cisco_scenario(scenario_id: str) -> dict:
    """Return Sentinel's structured recommendation for one scenario."""
    if not cisco_data.available():
        return {"error": "cisco_data_unavailable"}
    rec = await cisco_advisor.recommend(scenario_id)
    if rec is None:
        return {"error": "scenario_not_found", "scenario_id": scenario_id}
    return rec


@app.post("/api/cisco/evaluate_all")
async def evaluate_all_cisco() -> dict:
    """Run the advisor across all scenarios; useful for batch judging hook."""
    if not cisco_data.available():
        return {"error": "cisco_data_unavailable", "results": []}
    results = await cisco_advisor.recommend_all()
    return {"count": len(results), "results": results}


@app.post("/api/incidents/{incident_id}/call")
async def call_oncall(incident_id: str) -> dict:
    """Manually trigger a Twilio call for a given incident (demo button)."""
    for e in bus.history():
        if e.id == incident_id:
            return await twilio_call.place_call(e.model_dump(mode="json"))
    return {"placed": False, "error": "not_found"}


@app.get("/api/stream/token")
async def stream_token(user_id: str = "oncall") -> dict:
    """Mint a Stream Chat token + channel info for the browser SDK."""
    return stream_chat.gen_user_token(user_id)


_eval_cache: dict | None = None


@app.get("/api/eval")
async def eval_metrics() -> dict:
    """Run the ranker over labeled examples; cached after first call."""
    global _eval_cache
    if _eval_cache is None:
        m = await run_eval()
        _eval_cache = m.as_dict()
    return _eval_cache


@app.get("/api/events")
async def list_events() -> list[dict]:
    return [e.model_dump(mode="json") for e in bus.history()]


@app.get("/api/incidents")
async def list_incidents(
    min_severity: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Recent incidents (non-low by default), newest first."""
    order = ["low", "medium", "high", "critical"]
    threshold = order.index(min_severity) if min_severity in order else 1  # medium+
    items = [
        e for e in reversed(bus.history())
        if order.index(e.severity.value) >= threshold
    ][:limit]
    return [e.model_dump(mode="json") for e in items]


@app.get("/api/incidents/{incident_id}")
async def get_incident(incident_id: str) -> dict:
    for e in reversed(bus.history()):
        if e.id == incident_id:
            return e.model_dump(mode="json")
    return {"error": "not_found", "incident_id": incident_id}


@app.post("/api/incidents/{incident_id}/warroom")
async def open_warroom(incident_id: str, joiner: str = "oncall") -> dict:
    """Provision a TRTC war-room for a critical incident; returns join bundle."""
    for e in bus.history():
        if e.id == incident_id:
            bundle = trtc.warroom_for_incident(incident_id, joiner=joiner)
            bundle["incident"] = {
                "id": e.id,
                "tool": e.call.tool_name,
                "agent": e.call.agent_id,
                "category": e.assessment.category,
                "rationale": e.assessment.rationale,
                "score": e.assessment.score,
                "severity": e.severity.value,
            }
            return bundle
    return {"error": "not_found", "incident_id": incident_id}


@app.post("/api/incidents/{incident_id}/decide")
async def decide_incident(incident_id: str, body: dict) -> dict:
    """Update human decision on an incident. body = {action: 'block'|'release'|'escalate'}."""
    action = body.get("action", "").lower()
    valid = {"block": "keep_blocked", "release": "release", "escalate": "deny"}
    if action not in valid:
        return {"error": "invalid_action", "valid": list(valid.keys())}
    for e in bus.history():
        if e.id == incident_id:
            e.human_decision = valid[action]  # type: ignore[assignment]
            if action == "release":
                e.verdict = e.verdict.__class__("allow")  # type: ignore[arg-type]
            elif action == "block":
                e.verdict = e.verdict.__class__("block")  # type: ignore[arg-type]
            await bus.publish(e)
            return {"ok": True, "incident_id": incident_id, "action": action, "decision": valid[action]}
    return {"error": "not_found", "incident_id": incident_id}


@app.get("/api/events/stream")
async def stream_events():
    async def gen():
        async for event in bus.subscribe():
            yield {"event": "intercepted", "data": json.dumps(event.model_dump(mode="json"))}
    return EventSourceResponse(gen())


@app.post("/api/intercept")
async def post_intercept(call: ToolCall) -> InterceptedEvent:
    return await intercept(call)


@app.post("/api/demo/attack")
async def demo_attack() -> dict:
    await emit_demo_attack()
    return {"ok": True}


@app.post("/api/demo/clear_chat")
async def demo_clear_chat() -> dict:
    """Truncate the Stream incidents channel so the demo starts clean."""
    ok = await stream_chat.truncate_channel()
    return {"ok": ok}


@app.post("/api/demo/traffic/start")
async def traffic_start() -> dict:
    traffic.start()
    return {"running": traffic.running()}


@app.post("/api/demo/traffic/stop")
async def traffic_stop() -> dict:
    traffic.stop()
    return {"running": traffic.running()}
