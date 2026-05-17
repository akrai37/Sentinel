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
MAX_TOKENS = 900

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
  "reasoning": "<ONE crisp sentence (<250 chars) that connects the signals
                 to the action: 'X is happening, the runbook says Y, so we
                 should Z'. Plain English, an on-call engineer would say it.
                 Be concise. Do not truncate the action name.>",
  "next_steps": [
    "<3 to 4 concrete imperative actions an on-call engineer should take
     RIGHT NOW to execute the recommended_action. Each starts with a verb.
     Reference the target entity by name. Examples:
       'Roll the chat-mid-34b serving config back to the previous version.'
       'Move all jobs off gpu-node-09 to a healthy node.'
       'Confirm SLO recovery on chat-mid-34b within 15 minutes.'>"
  ],
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
- Output ONLY the JSON. No prose, no markdown.

For the failure_detective track, follow this priority order:
  1. GpuXidEccError alerts -> move_job, reason=hardware_fault, target=the
     affected node. Cite ECC error count and node id.
  2. NodeTemperatureHigh (>85C) or max_temperature_c > 85 -> move_job,
     reason=node_health, target=the hot node. Cite the temperature and power.
  3. CheckpointWriteTimeout or storage_timeouts > 5 ->
     restart_from_checkpoint, reason=checkpoint_failure,
     target=checkpoint-store. Cite the timeout count.
  4. FabricCongestionHigh -> move_job, reason=fabric_congestion,
     target=the affected rack. Cite the congested rack id and alert count.
  5. MemoryPressureHigh without hardware fault -> reduce_load,
     reason=memory_pressure, target=the affected model or service.
  6. JobFailureCluster with no infra-side alerts -> escalate, reason=no_action,
     target=the failing job ids.

For the performance_advisor track, key cues:
  - RolloutErrorRateHigh after a serving change -> rollback_config.
  - FabricCongestionHigh on a specific rack -> reroute_traffic.
  - NodeTemperatureHigh on the focus node -> reroute_traffic.
  - ReplicaErrorRateHigh (mostly 429s) -> add_capacity or reduce_load.
  - MemoryPressureHigh with high KV cache pressure -> reduce_load.

For the gpu_placement track, key cues:
  - High max_stranded_gpus + large_jobs_in_window > 0 -> reserve_full_node.
  - high_priority_jobs_in_window > 0 with queue wait -> prioritize_urgent_jobs.
  - unhealthy_nodes set or max_temperature_c > 85 -> avoid_unhealthy_node.
  - No large/high-priority pressure, idle slots -> backfill_small_jobs."""


@dataclass
class Recommendation:
    scenario_id: str
    recommended_action: str
    target: str
    reason_category: str
    confidence: float
    reasoning: str
    next_steps: list[str]
    evidence: list[str]
    used_llm: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "recommended_action": self.recommended_action,
            "target": self.target,
            "reason_category": self.reason_category,
            "confidence": round(self.confidence, 2),
            "reasoning": self.reasoning,
            "next_steps": self.next_steps,
            "evidence": self.evidence,
        }


# Templated reasoning the heuristic emits when LLM is offline
def _templated_reasoning(action: str, reason: str, target: str) -> str:
    if reason == "memory_pressure":
        return f"{target} shows sustained memory pressure; runbook says reduce batch size or lower concurrency before scaling."
    if reason == "node_health":
        return f"{target} is running hot or unhealthy; move work off it before placement causes hardware damage."
    if reason == "hardware_fault":
        return f"{target} reported GPU XID/ECC errors — local hardware fault, quarantine and move jobs."
    if reason == "checkpoint_failure":
        return f"Checkpoint writes are timing out against storage; restart from the most recent checkpoint once storage recovers."
    if reason == "fabric_congestion":
        return f"Fabric retransmits and RDMA latency are spiking on {target}; reroute traffic away from this rack."
    if reason == "bad_rollout":
        return f"Error rate climbed right after a serving change on {target}; roll the config back."
    if reason == "traffic_burst":
        return f"Demand on {target} is exceeding ready capacity; add replicas before the queue blocks more users."
    if reason == "fragmentation":
        return f"Idle GPUs are stranded across nodes; reserve full 8-GPU nodes so the large queued jobs can land."
    if reason == "priority_inversion":
        return f"High-priority jobs are waiting behind lower-priority work; reorder the queue."
    if reason == "no_action":
        return f"Signals are clean for {target}; no operational change required."
    return f"Recommend {action} for {target} based on the {reason} signal pattern."


def _templated_next_steps(action: str, target: str) -> list[str]:
    """Defensible 3-step playbook for the heuristic-only path."""
    t = target or "the affected entity"
    if action == "rollback_config":
        return [
            f"Roll {t} back to the previous serving configuration.",
            f"Verify rollout via deploy logs and replica readiness.",
            f"Confirm SLO recovery on {t} within 15 minutes.",
        ]
    if action == "reduce_load":
        return [
            f"Reduce batch size or concurrency on {t}.",
            f"Shed low-priority requests if pressure persists.",
            f"Watch KV cache and p95 latency for the next 10 minutes.",
        ]
    if action == "reroute_traffic":
        return [
            f"Drain serving traffic away from {t}.",
            f"Confirm healthy replicas pick up the load.",
            f"Investigate the underlying fabric or node fault.",
        ]
    if action == "add_capacity":
        return [
            f"Add reserved capacity for {t}.",
            f"Scale replicas to absorb the burst.",
            f"Re-evaluate SLO after capacity comes online.",
        ]
    if action == "move_job":
        return [
            f"Move active jobs off {t} to a healthy node or rack.",
            f"Quarantine {t} from new placements until it is inspected.",
            f"File a hardware ticket if XID/ECC or temperature anomalies persist.",
        ]
    if action == "restart_from_checkpoint":
        return [
            f"Wait for the storage path to recover.",
            f"Restart the affected job from the most recent checkpoint.",
            f"Reduce checkpoint frequency or stagger jobs if storage stays slow.",
        ]
    if action == "reserve_full_node":
        return [
            f"Reserve full 8-GPU nodes for the queued large jobs.",
            f"Hold backfill scheduling until the large jobs are admitted.",
            f"Re-enable backfill when the queue clears.",
        ]
    if action == "backfill_small_jobs":
        return [
            f"Backfill idle GPUs with small low-priority jobs.",
            f"Make sure backfill cannot block any queued multi-node job.",
            f"Reassess once queue or workload mix changes.",
        ]
    if action == "prioritize_urgent_jobs":
        return [
            f"Move high-priority jobs ahead of lower-priority work.",
            f"Notify owners of the bumped jobs.",
            f"Audit priority labels to prevent recurrence.",
        ]
    if action == "avoid_unhealthy_node":
        return [
            f"Cordon {t} from new placements.",
            f"Page hardware on-call to inspect {t}.",
            f"Uncordon once health metrics recover.",
        ]
    if action == "escalate":
        return [
            f"Escalate to the on-call engineer with the failing job IDs.",
            f"Attach the logs and signal summary for context.",
            f"Hold further automated action until a human acknowledges.",
        ]
    if action == "investigate_errors":
        return [
            f"Inspect the recent error logs and rollout history for {t}.",
            f"Identify whether the cause is configuration, capacity, or node health.",
            f"Decide on a targeted action once the root cause is clear.",
        ]
    if action == "no_action":
        return [
            f"Continue monitoring {t}.",
            f"Confirm signals stay clean over the next observation window.",
            f"Re-evaluate if any new alerts appear.",
        ]
    return [
        f"Take action: {action} on {t}.",
        f"Confirm the signals recover after the change.",
        f"Document the decision in the incident channel.",
    ]


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

    top_types_early = summary.get("top_alert_types") or ""
    if (
        critical_alerts == 0
        and slo == 0
        and errors == 0
        and not unhealthy
        and not top_types_early  # any non-critical alert type also blocks no_action
    ):
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
        # Route by PRIMARY alert (highest count) so an incidental secondary
        # alert can't hijack the decision. e.g. fail-006's primary is
        # JobFailureCluster even though MemoryPressureHigh appears later.
        top_types = summary.get("top_alert_types") or ""
        if primary_alert == "GpuXidEccError":
            action = pick("move_job", "retry_job")
            reason = "hardware_fault"
            score = 0.85
        elif primary_alert == "NodeTemperatureHigh" or max_temp > 85:
            action = pick("move_job", "retry_job")
            reason = "node_health"
            score = 0.82
        elif primary_alert == "CheckpointWriteTimeout" or chk_timeouts or storage_timeouts > 5:
            action = pick("restart_from_checkpoint", "retry_job")
            reason = "checkpoint_failure"
            score = 0.82
        elif primary_alert == "FabricCongestionHigh" or congested:
            action = pick("move_job", "retry_job")
            reason = "fabric_congestion"
            score = 0.8
        elif primary_alert == "MemoryPressureHigh":
            # Memory pressure must beat a bare unhealthy-node signal:
            # an incidentally unhealthy node does not override the primary
            # memory-pressure cause. (fail-003)
            action = pick("reduce_load", "retry_job")
            reason = "memory_pressure"
            score = 0.78
        elif primary_alert == "JobFailureCluster":
            # JobFailureCluster with no infra-side signals: per the runbook,
            # escalate to the job owner. (fail-006)
            action = pick("escalate", "retry_job")
            reason = "no_action"
            score = 0.72
        elif unhealthy:
            action = pick("move_job", "retry_job")
            reason = "hardware_fault"
            score = 0.78
        elif critical_alerts == 0 and errors == 0:
            action = pick("no_action", "retry_job")
            reason = "no_action"
            score = 0.6
        else:
            action = pick("escalate", "retry_job")
            reason = "no_action"
            score = 0.55
        evidence = [
            f"primary alert {primary_alert or 'none'} ({critical_alerts} critical alerts, top types: {top_types or 'none'})",
            f"checkpoint_timeouts={chk_timeouts}, storage_timeouts={storage_timeouts}, max_temp={max_temp}C",
            f"unhealthy nodes: {unhealthy or 'none'} · congested racks: {congested or 'none'}",
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
        reasoning=_templated_reasoning(action, reason, focus),
        next_steps=_templated_next_steps(action, focus),
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
            # Fall back to heuristic but keep the LLM evidence + reasoning
            heur = _heuristic(brief)
            heur.evidence = [str(e)[:240] for e in d.get("evidence", [])][:5] or heur.evidence
            if d.get("reasoning"):
                heur.reasoning = str(d["reasoning"])[:320]
            llm_steps = [str(s)[:240] for s in (d.get("next_steps") or [])][:4]
            if llm_steps:
                heur.next_steps = llm_steps
            heur.used_llm = True
            return heur
        target = str(d.get("target", s.get("focus_entity", "")))[:120]
        reason = str(d.get("reason_category", "no_action"))[:48]
        reasoning = (
            str(d.get("reasoning"))[:320] if d.get("reasoning")
            else _templated_reasoning(action, reason, target)
        )
        next_steps = [str(s)[:240] for s in (d.get("next_steps") or [])][:4]
        if not next_steps:
            next_steps = _templated_next_steps(action, target)
        return Recommendation(
            scenario_id=s["scenario_id"],
            recommended_action=action,
            target=target,
            reason_category=reason,
            confidence=max(0.0, min(1.0, float(d.get("confidence", 0.6)))),
            reasoning=reasoning,
            next_steps=next_steps,
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
