"""Cisco AI-Factory dataset loader.

Loads the public CSVs lazily on first use and caches them. Keeps memory
modest: the largest file (inference_requests, ~5MB) is fine in-process.
"""
from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

BASE = Path(__file__).resolve().parent.parent.parent / "cisco_data" / "ai_factory_hackathon_student"
PUBLIC = BASE / "data" / "public"


def available() -> bool:
    return PUBLIC.exists() and (PUBLIC / "evaluation_scenarios.csv").exists()


def _read_csv(name: str) -> list[dict[str, str]]:
    path = PUBLIC / name
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


@lru_cache(maxsize=None)
def scenarios() -> list[dict[str, Any]]:
    return _read_csv("evaluation_scenarios.csv")


@lru_cache(maxsize=None)
def scenario_summary() -> dict[str, dict[str, Any]]:
    return {row["scenario_id"]: row for row in _read_csv("scenario_signal_summary.csv")}


@lru_cache(maxsize=None)
def action_menu() -> dict[str, list[dict[str, str]]]:
    menu: dict[str, list[dict[str, str]]] = {}
    for row in _read_csv("action_menu.csv"):
        menu.setdefault(row["track_id"], []).append(row)
    return menu


@lru_cache(maxsize=None)
def runbooks() -> dict[str, str]:
    text = (PUBLIC / "runbooks.md").read_text()
    sections: dict[str, str] = {}
    current_title: str | None = None
    current_lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            if current_title is not None:
                sections[current_title] = "\n".join(current_lines).strip()
            current_title = line[3:].strip()
            current_lines = []
        elif current_title is not None:
            current_lines.append(line)
    if current_title is not None:
        sections[current_title] = "\n".join(current_lines).strip()
    return sections


@dataclass(frozen=True)
class TimeWindow:
    start: datetime
    end: datetime

    def contains(self, ts_str: str) -> bool:
        if not ts_str:
            return False
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except ValueError:
            return False
        return self.start <= ts <= self.end


def scenario_window(scenario_id: str) -> TimeWindow | None:
    s = next((row for row in scenarios() if row["scenario_id"] == scenario_id), None)
    if not s:
        return None
    start = datetime.fromisoformat(s["start_time"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(s["end_time"].replace("Z", "+00:00"))
    return TimeWindow(start, end)


def alerts_in_window(window: TimeWindow, *, focus_entity: str | None = None,
                      limit: int = 25) -> list[dict[str, str]]:
    rows = _read_csv("alerts.csv")
    out = []
    for r in rows:
        if not window.contains(r.get("timestamp", "")):
            continue
        if focus_entity and focus_entity not in (
            r.get("entity") or "",
            r.get("model") or "",
            r.get("node") or "",
            r.get("rack") or "",
        ):
            # don't filter aggressively; alerts may not match focus literally
            pass
        out.append(r)
        if len(out) >= limit:
            break
    return out


def logs_in_window(window: TimeWindow, limit: int = 15) -> list[dict[str, str]]:
    rows = _read_csv("logs.csv")
    out = [r for r in rows if window.contains(r.get("timestamp", ""))]
    return out[:limit]


def scenario_brief(scenario_id: str) -> dict[str, Any] | None:
    """All the context needed to recommend an action for one scenario."""
    s = next((row for row in scenarios() if row["scenario_id"] == scenario_id), None)
    if not s:
        return None
    summary = scenario_summary().get(scenario_id, {})
    window = scenario_window(scenario_id)
    return {
        "scenario": s,
        "summary": summary,
        "actions": action_menu().get(s["track_id"], []),
        "alerts": alerts_in_window(window, focus_entity=s.get("focus_entity")) if window else [],
        "logs": logs_in_window(window) if window else [],
    }
