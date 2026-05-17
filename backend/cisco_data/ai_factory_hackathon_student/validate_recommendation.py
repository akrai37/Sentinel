#!/usr/bin/env python3
"""Validate structured scenario recommendation output.

This checks format only. Final correctness scoring is done by organizers.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any


SCENARIOS_PATH = Path("data/public/evaluation_scenarios.csv")
REQUIRED_FIELDS = [
    "scenario_id",
    "recommended_action",
    "target",
    "reason_category",
    "confidence",
    "evidence",
]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_recommendations(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("Recommendation file is empty")

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if isinstance(payload, dict) and "recommendations" in payload:
        payload = payload["recommendations"]
    elif isinstance(payload, dict):
        payload = [payload]

    if not isinstance(payload, list):
        raise ValueError("Expected a JSON object, JSON array, or object with a recommendations array")

    recommendations: list[dict[str, Any]] = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Recommendation #{index} is not an object")
        recommendations.append(item)
    return recommendations


def evidence_ok(value: Any) -> bool:
    if isinstance(value, list):
        return any(str(item).strip() for item in value)
    return bool(str(value).strip())


def validate(path: Path, require_all: bool) -> None:
    scenarios = read_csv(SCENARIOS_PATH)
    expected_ids = {row["scenario_id"] for row in scenarios}
    recommendations = load_recommendations(path)

    seen_ids: set[str] = set()
    for index, item in enumerate(recommendations, start=1):
        missing = [field for field in REQUIRED_FIELDS if field not in item]
        if missing:
            raise ValueError(f"Recommendation #{index} is missing fields: {', '.join(missing)}")

        scenario_id = str(item["scenario_id"])
        if scenario_id not in expected_ids:
            raise ValueError(f"Unknown scenario_id in recommendation #{index}: {scenario_id}")
        if scenario_id in seen_ids:
            raise ValueError(f"Duplicate scenario_id: {scenario_id}")
        seen_ids.add(scenario_id)

        if not evidence_ok(item["evidence"]):
            raise ValueError(f"Recommendation for {scenario_id} has empty evidence")

    if require_all:
        missing_ids = sorted(expected_ids - seen_ids)
        if missing_ids:
            raise ValueError(f"Missing scenario IDs: {', '.join(missing_ids)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate recommendation JSON format.")
    parser.add_argument("path", help="Path to recommendation JSON")
    parser.add_argument(
        "--require-all",
        action="store_true",
        help="Require recommendations for every evaluation scenario",
    )
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(f"Recommendation file not found: {path}", file=sys.stderr)
        return 2

    try:
        validate(path, require_all=args.require_all)
    except ValueError as exc:
        print(f"Invalid recommendation file: {exc}", file=sys.stderr)
        return 1

    print("Recommendation format looks valid. Organizers will run final scoring.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
