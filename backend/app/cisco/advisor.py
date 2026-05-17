"""Cisco AI-Factory advisor — turns a scenario_id into a structured
recommendation per the judging hook spec.

Strategy:
  1. Pull the scenario's brief (scenario row + signal summary + alerts + logs
     + runbook hints + allowed actions for the track).
  2. Use a runbook keyword lookup to fetch the most relevant runbook section.
  3. Ask Claude Haiku to pick exactly one action from the menu, cite the
     target, the reason category, the confidence, and 3–5 evidence strings
     grounded in the data we passed in.
  4. Validate the model's choice against the action menu; fall back to a
     deterministic heuristic if needed.

If ANTHROPIC_API_KEY is missing the heuristic path runs alone and the
recommendation is honest about that.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

from . import data

log = logging.getLogger("sentinel.cisco")

try:
    from anthropic import AsyncAnthropic
    _client: AsyncAnthropic | None = AsyncAnthropic() if os.getenv("ANTHROPIC_API_KEY") else None
except Exception:
    _client = None

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 600

SYSTEM_PROMPT = """You are Sentinel, an AI-ops advisor for AI Factory infrastructure.

Given one scenario from the Cisco AI Factory dataset (signals, alerts, logs,
and runbook hints) and the allowed action menu for the scenario's track,
return STRICT JSON with this shape:

{
  "recommended_action": "<one action_id from the menu>",
  "target": "<the affected model, node, rack, job_group, or service>",
  "reason_category": "<one of: memory_pressure, traffic_burst, fragmentation,
                       bad_rollout, node_health, fabric_congestion,
                       storage_timeout, checkpoint_failure, priority_inversion,
                       hardware_fault, no_action>",
  "confidence": <float 0.0-1.0>,
  "evidence": [
    "<3 to 5 short evidence statements grounded in the data you were shown>"
  ]
}

Rules:
- Pick exactly one action_id that appears in the action menu.
- Ground every evidence statement in a concrete number, alert type, log
  message, or runbook line that was provided. Do not invent fields.
- Prefer no_action only when signals are clean (no alerts, no SLO breach,
  no unhealthy nodes).
- Output ONLY the JSON. No prose, no markdown."""


@dataclass
class Recommendation:
    scenario_id: str
    recommended_action: str
    target: str
    reason_category: str
    confidence: float
    evidence: list[str]
    used_llm: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "recommended_action": self.recommended_action,
            "target": self.target,
            "reason_category": self.reason_category,
            "confidence": round(self.confidence, 2),
            "evidence": self.evidence,
        }


# ---------- runbook retrieval ----------

def _relevant_runbooks(summary: dict[str, str]) -> dict[str, str]:
    """Match alert types from the summary to runbook section titles."""
    rb = data.runbooks()
    top = summary.get("top_alert_types", "") or ""
    titles = []
    for chunk in top.split("|"):
        if not chunk:
            continue
        title = chunk.split(":", 1)[0]
        if title in rb:
            titles.append(title)
    return {t: rb[t] for t in titles}


# ---------- heuristic fallback ----------

def _heuristic(brief: dict[str, Any]) -> Recommendation:
    """A deterministic, defensible recommendation when no LLM is available."""
    s = brief["scenario"]
    summary = brief["summary"]
    track = s["track_id"]
    focus = s.get("focus_entity", "unknown")
    actions = {a["action_id"]: a for a in brief["actions"]}
    top_alerts = (summary.get("top_alert_types") or "").split("|")
    primary_alert = top_alerts[0].split(":", 1)[0] if top_alerts and top_alerts[0] else ""

    def pick(action_id: str, fallback: str) -> str:
        return action_id if action_id in actions else fallback

    reason = "no_action"
    action = "no_action"
    evidence = []
    score = 0.55

    critical_alerts = int(summary.get("critical_alerts") or 0)
    slo = int(summary.get("slo_violation_count") or 0)
    errors = int(summary.get("error_count") or 0)
    unhealthy = (summary.get("unhealthy_nodes") or "").strip()
    congested = (summary.get("congested_racks") or "").strip()
    chk_timeouts = int(summary.get("checkpoint_timeouts") or 0)
    storage_timeouts = int(summary.get("storage_timeouts") or 0)
    max_temp = float(summary.get("max_temperature_c") or 0)

    if critical_alerts == 0 and slo == 0 and errors == 0 and not unhealthy:
        action = pick("no_action", "no_action")
        reason = "no_action"
        evidence = [
            f"No critical alerts, SLO violations, or unhealthy nodes in window for {focus}.",
        ]
        score = 0.8
    elif track == "performance_advisor":
        if primary_alert == "MemoryPressureHigh":
            action = pick("reduce_load", "investigate_errors")
            reason = "memory_pressure"
            score = 0.85
        elif primary_alert == "RolloutErrorRateHigh":
            action = pick("rollback_config", "investigate_errors")
            reason = "bad_rollout"
            score = 0.82
        elif primary_alert == "FabricCongestionHigh" or congested:
            action = pick("reroute_traffic", "investigate_errors")
            reason = "fabric_congestion"
            score = 0.78
        elif primary_alert == "ReplicaErrorRateHigh":
            action = pick("add_capacity", "investigate_errors")
            reason = "traffic_burst"
            score = 0.72
        elif unhealthy or max_temp > 80:
            action = pick("reroute_traffic", "investigate_errors")
            reason = "node_health"
            score = 0.75
        else:
            action = pick("investigate_errors", "no_action")
            reason = "no_action"
            score = 0.55
        evidence = [
            f"primary alert {primary_alert or 'none'} ({summary.get('critical_alerts', '?')} critical alerts in window)",
            f"p95 latency {summary.get('p95_latency_ms')}ms over {summary.get('request_count')} requests, {slo} SLO breaches, {errors} errors",
            f"unhealthy nodes: {unhealthy or 'none'} · congested racks: {congested or 'none'}",
        ]
    elif track == "failure_detective":
        if chk_timeouts or storage_timeouts:
            action = pick("restart_from_checkpoint", "retry_job")
            reason = "checkpoint_failure"
            score = 0.82
        elif unhealthy or "GpuXidEccError" in (summary.get("top_alert_types") or ""):
            action = pick("move_job", "retry_job")
            reason = "hardware_fault"
            score = 0.8
        elif primary_alert == "MemoryPressureHigh":
            action = pick("reduce_load", "retry_job")
            reason = "memory_pressure"
            score = 0.75
        elif critical_alerts == 0 and errors == 0:
            action = pick("no_action", "retry_job")
            reason = "no_action"
            score = 0.6
        else:
            action = pick("escalate", "retry_job")
            reason = "no_action"
            score = 0.55
        evidence = [
            f"primary alert {primary_alert or 'none'} ({critical_alerts} critical alerts)",
            f"checkpoint_timeouts={chk_timeouts}, storage_timeouts={storage_timeouts}",
            f"unhealthy nodes: {unhealthy or 'none'}",
        ]
    elif track == "gpu_placement":
        large = int(summary.get("large_jobs_in_window") or 0)
        high = int(summary.get("high_priority_jobs_in_window") or 0)
        stranded = int(summary.get("max_stranded_gpus") or 0)
        if high and (stranded or summary.get("max_queued_requests")):
            action = pick("prioritize_urgent_jobs", "no_action")
            reason = "priority_inversion"
            score = 0.78
        elif large and stranded:
            action = pick("reserve_full_node", "no_action")
            reason = "fragmentation"
            score = 0.8
        elif unhealthy or max_temp > 80:
            action = pick("avoid_unhealthy_node", "no_action")
            reason = "node_health"
            score = 0.78
        elif not large and not high:
            action = pick("backfill_small_jobs", "no_action")
            reason = "no_action"
            score = 0.65
        else:
            action = pick("no_action", "no_action")
            reason = "no_action"
            score = 0.55
        evidence = [
            f"large_jobs={large}, high_priority_jobs={high}, max_stranded_gpus={stranded}",
            f"unhealthy nodes: {unhealthy or 'none'}",
            f"max temperature {max_temp}C",
        ]

    return Recommendation(
        scenario_id=s["scenario_id"],
        recommended_action=action,
        target=focus,
        reason_category=reason,
        confidence=score,
        evidence=evidence,
        used_llm=False,
    )


# ---------- LLM path ----------

def _build_user_payload(brief: dict[str, Any]) -> str:
    s = brief["scenario"]
    summary = brief["summary"]
    rb = _relevant_runbooks(summary)
    payload = {
        "scenario": {
            "scenario_id": s["scenario_id"],
            "track_id": s["track_id"],
            "focus_entity": s.get("focus_entity"),
            "window": [s["start_time"], s["end_time"]],
            "prompt": s.get("prompt"),
        },
        "signal_summary": {
            k: v for k, v in summary.items()
            if v not in ("", None) and k not in ("scenario_id", "track_id")
        },
        "alerts_sample": [
            {k: r.get(k) for k in ("timestamp", "severity", "alert_type", "entity", "message")}
            for r in brief["alerts"][:10]
        ],
        "logs_sample": [
            {k: r.get(k) for k in ("timestamp", "service", "level", "message")}
            for r in brief["logs"][:8]
        ],
        "runbooks": rb,
        "actions": [
            {"action_id": a["action_id"], "description": a["description"]}
            for a in brief["actions"]
        ],
    }
    return json.dumps(payload, separators=(",", ":"))[:6000]


async def _llm_recommend(brief: dict[str, Any]) -> Recommendation | None:
    if _client is None:
        return None
    s = brief["scenario"]
    user = _build_user_payload(brief)
    try:
        resp = await _client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
        if text.startswith("```"):
            text = text.strip("`").lstrip("json").strip()
        d = json.loads(text)
        valid_ids = {a["action_id"] for a in brief["actions"]}
        action = d.get("recommended_action")
        if action not in valid_ids:
            # Fall back to heuristic but keep the LLM evidence
            heur = _heuristic(brief)
            heur.evidence = [str(e)[:240] for e in d.get("evidence", [])][:5] or heur.evidence
            heur.used_llm = True
            return heur
        return Recommendation(
            scenario_id=s["scenario_id"],
            recommended_action=action,
            target=str(d.get("target", s.get("focus_entity", "")))[:120],
            reason_category=str(d.get("reason_category", "no_action"))[:48],
            confidence=max(0.0, min(1.0, float(d.get("confidence", 0.6)))),
            evidence=[str(e)[:240] for e in d.get("evidence", [])][:5],
            used_llm=True,
        )
    except Exception as exc:
        log.warning("LLM recommend failed for %s: %s", s["scenario_id"], exc)
        return None


# ---------- public API ----------

async def recommend(scenario_id: str) -> dict[str, Any] | None:
    brief = data.scenario_brief(scenario_id)
    if brief is None:
        return None
    llm = await _llm_recommend(brief)
    rec = llm or _heuristic(brief)
    out = rec.as_dict()
    out["used_llm"] = rec.used_llm
    out["scenario"] = {
        "track_id": brief["scenario"]["track_id"],
        "focus_entity": brief["scenario"].get("focus_entity"),
        "prompt": brief["scenario"].get("prompt"),
        "window": [brief["scenario"]["start_time"], brief["scenario"]["end_time"]],
    }
    return out


async def recommend_all() -> list[dict[str, Any]]:
    results = []
    for s in data.scenarios():
        rec = await recommend(s["scenario_id"])
        if rec is not None:
            results.append(rec)
    return results
