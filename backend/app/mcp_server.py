"""Sentinel MCP server (stdio) — exposed to VoiceOS via Custom Integrations.

VoiceOS launches this process via `start.sh`. Voice commands map to tool calls:

  "what's the latest critical?"  → incidents_lookup(min_severity="critical")
  "block agent prod-coder-7"     → incidents_decide(incident_id=..., action="block")
  "release the last one"         → incidents_decide(incident_id=..., action="release")

Tools are thin shims over Sentinel's FastAPI backend on `:8000`.
"""
import os
from typing import Any, Literal

import httpx
from mcp.server.fastmcp import FastMCP

API_BASE = os.environ.get("SENTINEL_API", "http://localhost:8000")
TIMEOUT = 5.0

mcp = FastMCP("sentinel")


def _http() -> httpx.Client:
    return httpx.Client(base_url=API_BASE, timeout=TIMEOUT)


def _fmt_incident(e: dict[str, Any]) -> dict[str, Any]:
    """Trim a raw event to what VoiceOS needs to speak."""
    return {
        "id": e["id"],
        "severity": e["severity"],
        "agent": e["call"]["agent_id"],
        "tool": e["call"]["tool_name"],
        "arguments": e["call"]["arguments"],
        "category": e["assessment"]["category"],
        "score": e["assessment"]["score"],
        "rationale": e["assessment"]["rationale"],
        "verdict": e["verdict"],
        "human_decision": e.get("human_decision"),
        "decided_at": e["decided_at"],
    }


@mcp.tool()
def incidents_lookup(
    incident_id: str | None = None,
    min_severity: Literal["low", "medium", "high", "critical"] = "medium",
    limit: int = 5,
) -> dict[str, Any]:
    """Look up recent Sentinel incidents (medium severity or above by default).

    Use this when the engineer asks things like "what's the latest?",
    "what's happening?", or "show me critical incidents".

    Args:
        incident_id: optional specific incident id to fetch.
        min_severity: filter floor — one of "low", "medium", "high", "critical".
        limit: max incidents to return when listing (default 5).
    """
    with _http() as client:
        if incident_id:
            r = client.get(f"/api/incidents/{incident_id}")
            r.raise_for_status()
            data = r.json()
            if data.get("error"):
                return {"found": False, "error": data["error"]}
            return {"found": True, "incident": _fmt_incident(data)}
        r = client.get(
            "/api/incidents",
            params={"min_severity": min_severity, "limit": limit},
        )
        r.raise_for_status()
        items = [_fmt_incident(e) for e in r.json()]
        return {"count": len(items), "incidents": items}


@mcp.tool()
def incidents_decide(
    incident_id: str,
    action: Literal["block", "release", "escalate"],
) -> dict[str, Any]:
    """Record a human decision on a Sentinel incident.

    Use this when the engineer says "block it", "release it", or "escalate".

    Args:
        incident_id: the incident id (from incidents_lookup).
        action: "block" (keep blocked), "release" (allow), or "escalate".
    """
    with _http() as client:
        r = client.post(
            f"/api/incidents/{incident_id}/decide",
            json={"action": action},
        )
        r.raise_for_status()
        return r.json()


@mcp.tool()
def sentinel_status() -> dict[str, Any]:
    """Quick health summary of Sentinel — useful for 'is everything ok?'"""
    with _http() as client:
        stats = client.get("/api/stats").json()
        recent = client.get("/api/incidents", params={"limit": 1, "min_severity": "critical"}).json()
    return {
        "events_seen": stats["events_seen"],
        "traffic_running": stats["traffic_running"],
        "llm_mode": "online" if stats["llm"]["available"] else "heuristic-only",
        "latest_critical": _fmt_incident(recent[0]) if recent else None,
    }


@mcp.tool()
def cisco_scenarios() -> dict[str, Any]:
    """List the Cisco AI Factory scenarios Sentinel can evaluate.

    Use this when the engineer asks 'what Cisco scenarios are there?' or
    'show me failure detective scenarios'. Each scenario has an id like
    perf-001, gpu-003, fail-002 mapped to one of three tracks.
    """
    with _http() as client:
        r = client.get("/api/cisco/scenarios")
        r.raise_for_status()
        items = r.json()
    return {
        "count": len(items),
        "scenarios": [
            {
                "scenario_id": s["scenario_id"],
                "track": s["track_id"],
                "focus_entity": s["focus_entity"],
                "prompt": s["prompt"],
                "critical_alerts": s["critical_alerts"],
            }
            for s in items
        ],
    }


@mcp.tool()
def cisco_evaluate(scenario_id: str) -> dict[str, Any]:
    """Run Sentinel's Failure Detective on one Cisco AI Factory scenario.

    Use this when the engineer asks 'evaluate perf-001', 'what should we do
    about scenario gpu-003?', or 'analyze that failure'. Returns a structured
    recommendation with action, target, reason, confidence, and evidence
    grounded in the dataset's alerts, logs, and runbooks.
    """
    with _http() as client:
        r = client.post(f"/api/cisco/evaluate/{scenario_id}")
        r.raise_for_status()
        return r.json()


if __name__ == "__main__":
    mcp.run()
