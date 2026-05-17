#!/usr/bin/env python3
"""Simple baseline summaries for the full AI Factory Ops dataset.

These examples intentionally use only the Python standard library. They are
not meant to be strong solutions; they are sanity checks and starter baselines.
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean


PUBLIC_DIR = Path("data/public")


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def within(row: dict, start: datetime, end: datetime, timestamp_column: str = "timestamp") -> bool:
    ts = parse_ts(row[timestamp_column])
    return start <= ts <= end


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = round((len(ordered) - 1) * pct)
    return ordered[index]


def scenarios_by_track(track_id: str) -> list[dict]:
    return [
        row for row in read_csv(PUBLIC_DIR / "evaluation_scenarios.csv")
        if row["track_id"] == track_id
    ]


def track_1_performance_advisor() -> None:
    requests = read_csv(PUBLIC_DIR / "inference_requests.csv")
    replicas = read_csv(PUBLIC_DIR / "serving_replicas.csv")
    node_metrics = read_csv(PUBLIC_DIR / "node_metrics.csv")
    alerts = read_csv(PUBLIC_DIR / "alerts.csv")
    scenarios = scenarios_by_track("performance_advisor")

    print("Track 1: AI App Performance Advisor")
    print(f"  Evaluation scenarios: {len(scenarios)}")
    for scenario in scenarios[:3]:
        start = parse_ts(scenario["start_time"])
        end = parse_ts(scenario["end_time"])
        window_requests = [row for row in requests if within(row, start, end)]
        latencies = [int(row["latency_ms"]) for row in window_requests]
        error_count = sum(1 for row in window_requests if row["status_code"] != "200")
        window_alerts = [row["alert_type"] for row in alerts if within(row, start, end)]
        window_replicas = [row for row in replicas if within(row, start, end)]
        max_queue = max([int(row["queued_requests"]) for row in window_replicas] or [0])
        hot_nodes = [
            row["node_id"] for row in node_metrics
            if within(row, start, end) and row["health_state"] != "normal"
        ]
        print(
            f"  {scenario['scenario_id']}: p95 latency={percentile(latencies, 0.95):.0f}ms, "
            f"errors={error_count}, max queued={max_queue}, "
            f"alerts={dict(Counter(window_alerts))}, unhealthy_nodes={sorted(set(hot_nodes))[:4]}"
        )
    print()


def track_2_gpu_placement() -> None:
    jobs = read_csv(PUBLIC_DIR / "job_queue.csv")
    snapshots = read_csv(PUBLIC_DIR / "placement_snapshots.csv")
    scenarios = scenarios_by_track("gpu_placement")

    queue_waits = [int(row["queue_wait_min"]) for row in jobs]
    high_priority_waits = [
        int(row["queue_wait_min"]) for row in jobs if row["priority"] == "high"
    ]
    large_job_waits = [
        int(row["queue_wait_min"]) for row in jobs if int(row["requested_gpus"]) >= 8
    ]
    stranded_by_window = defaultdict(int)
    for row in snapshots:
        hour = parse_ts(row["timestamp"]).replace(minute=0, second=0, microsecond=0).isoformat()
        stranded_by_window[hour] += int(row["stranded_gpus"])

    print("Track 2: GPU Job Placement Challenge")
    print(f"  Evaluation scenarios: {len(scenarios)}")
    print(f"  Jobs observed: {len(jobs)}")
    print(f"  Average queue wait: {mean(queue_waits):.1f} minutes")
    print(f"  P95 queue wait: {percentile(queue_waits, 0.95):.0f} minutes")
    print(f"  High-priority average queue wait: {mean(high_priority_waits):.1f} minutes")
    print(f"  Large-job P95 queue wait: {percentile(large_job_waits, 0.95):.0f} minutes")
    if stranded_by_window:
        worst_hour, stranded = max(stranded_by_window.items(), key=lambda item: item[1])
        print(f"  Worst stranded-GPU hour: {worst_hour} with {stranded} stranded GPUs")
    print()


def track_3_failure_detective() -> None:
    alerts = read_csv(PUBLIC_DIR / "alerts.csv")
    logs = read_csv(PUBLIC_DIR / "logs.csv")
    checkpoints = read_csv(PUBLIC_DIR / "checkpoint_events.csv")
    storage = read_csv(PUBLIC_DIR / "storage_metrics.csv")
    scenarios = scenarios_by_track("failure_detective")

    severity_counts = Counter(row["severity"] for row in alerts)
    alert_type_counts = Counter(row["alert_type"] for row in alerts)
    error_logs = [row for row in logs if row["severity"] == "ERROR"]
    checkpoint_failures = [row for row in checkpoints if row["status"] != "success"]
    storage_timeouts = sum(int(row["timeout_count"]) for row in storage)

    print("Track 3: AI Job Failure Detective")
    print(f"  Evaluation scenarios: {len(scenarios)}")
    print(f"  Alerts observed: {len(alerts)}")
    print(f"  Alerts by severity: {dict(severity_counts)}")
    print(f"  Top alert types: {alert_type_counts.most_common(5)}")
    print(f"  Error logs: {len(error_logs)}")
    print(f"  Failed checkpoint events: {len(checkpoint_failures)}")
    print(f"  Total storage timeout count: {storage_timeouts}")
    print()


def main() -> None:
    track_1_performance_advisor()
    track_2_gpu_placement()
    track_3_failure_detective()


if __name__ == "__main__":
    main()
