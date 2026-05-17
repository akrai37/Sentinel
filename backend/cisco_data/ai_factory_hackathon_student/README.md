# AI Factory Ops Challenge

## The Theme

**AI Factory Ops: Engineering the Infrastructure Behind AI**

AI applications depend on compute, GPUs, networking, storage, schedulers, alerts, logs, and fast decisions. For this challenge, you will build something useful for a **Synthetic AI Factory** using the provided dataset.

You do **not** need GPUs, production access, or external services to build a strong project.

## What You Are Building

Build a working prototype that helps someone understand or improve what is happening inside the Synthetic AI Factory.

Your project can be a dashboard, simulator, scheduler or placement planner, incident investigator, performance visualizer, notebook, CLI, local AI workflow, or web app.

The form is up to you. The goal is to use the data to make AI infrastructure decisions easier, faster, or more understandable.

## Start Here

1. Open `data/public/evaluation_scenarios.csv`.
2. Open `data/public/scenario_signal_summary.csv`.
3. Pick a starting point or combine multiple areas.
4. Build a runnable prototype.
5. Make sure your project can evaluate a scenario and show a structured recommendation.

If you like SQL, use `ai_factory.duckdb` and `example_queries.sql`. If you prefer Python or spreadsheets, use the CSV files directly.

## How To Use The Data

Think of the CSVs as different signal layers from the same Synthetic AI Factory.

Start with:

1. `evaluation_scenarios.csv`  
   Tells you which scenario to analyze, the time window, the focus entity, and the track.
2. `scenario_signal_summary.csv`  
   Gives a beginner-friendly summary of the important signals for each scenario.
3. Raw signal files  
   Use these to find evidence for your recommendation. You do not need every file.
4. `action_menu.csv`  
   Pick one allowed action for the scenario's track.
5. Your project output  
   Show the recommended action, target, reason, confidence, and evidence.

Recommended files by direction:

- **Performance Advisor:** `inference_requests.csv`, `serving_replicas.csv`, `node_metrics.csv`, `alerts.csv`, `logs.csv`
- **GPU Placement Planner:** `job_queue.csv`, `placement_snapshots.csv`, `gpu_nodes.csv`, `node_metrics.csv`
- **Failure Detective:** `alerts.csv`, `logs.csv`, `job_queue.csv`, `checkpoint_events.csv`, `storage_metrics.csv`, `node_metrics.csv`, `runbooks.md`

## The Judging Hook

To make judging consistent, every project should expose a simple way to evaluate a scenario.

Given a `scenario_id`, your project should show or return:

```json
{
  "scenario_id": "perf-001",
  "recommended_action": "TODO",
  "target": "TODO",
  "reason_category": "TODO",
  "confidence": 0.0,
  "evidence": [
    "TODO: cite metrics, logs, alerts, runbook notes, or derived signals"
  ]
}
```

This structured recommendation is **not** the whole project. It is just the common output judges can compare across very different prototypes.

You can expose this through a UI, notebook cell, CLI command, local endpoint, or generated JSON file. Start from `data/public/sample_recommendations.json` if you want a template.

## What To Submit

Submit:

- your runnable project
- a short demo
- a way to evaluate at least one scenario using the judging hook above

Strong projects should make it obvious how the recommendation was produced, not just print an answer.

## Simple Build Path

If you are not sure where to start, build this:

1. Load `data/public/evaluation_scenarios.csv`.
2. Open `data/public/scenario_signal_summary.csv`.
3. Pick one scenario and one pressure point to investigate.
4. Check one or two raw files for evidence.
5. Pick one action from `data/public/action_menu.csv`.
6. Show the action, target, reason, confidence, and evidence in your project.
7. Add a small UI, chart, simulator, notebook flow, or local AI workflow that makes the decision easier to trust.

You do not need to analyze every file. Start with the summary file, then use raw files to back up your recommendation.

## Starting Points

You can focus on one of these or build something that cuts across them.

### 1. Performance Advisor

Help diagnose why an AI app is slow or failing.

Start with these files:

- `evaluation_scenarios.csv`
- `scenario_signal_summary.csv`
- `inference_requests.csv`
- `serving_replicas.csv`
- `node_metrics.csv`
- `alerts.csv`
- `logs.csv`
- `action_menu.csv`

Look for high latency, 429 or 500 errors, request queues, memory or KV cache pressure, unhealthy nodes, and bad rollout logs.

Possible project ideas:

- latency triage dashboard
- serving bottleneck explainer
- routing or scale recommendation tool
- local model that summarizes evidence from logs and metrics

### 2. GPU Placement Planner

Help decide how GPU jobs should be scheduled on 8-GPU servers.

Start with these files:

- `evaluation_scenarios.csv`
- `scenario_signal_summary.csv`
- `job_queue.csv`
- `placement_snapshots.csv`
- `gpu_nodes.csv`
- `node_metrics.csv`
- `action_menu.csv`

Look for large jobs waiting, high-priority jobs waiting, partially used nodes, stranded GPUs, and unhealthy nodes.

Possible project ideas:

- interactive 8-GPU node placement board
- queue wait predictor
- fragmentation visualizer
- scheduler simulator that compares placement choices

### 3. Failure Detective

Help identify why AI jobs or services failed and what to do next.

Start with these files:

- `evaluation_scenarios.csv`
- `scenario_signal_summary.csv`
- `alerts.csv`
- `logs.csv`
- `job_queue.csv`
- `checkpoint_events.csv`
- `storage_metrics.csv`
- `node_metrics.csv`
- `runbooks.md`
- `action_menu.csv`

Look for checkpoint write timeouts, node temperature or GPU errors, network or storage symptoms, failed jobs, and matching runbook guidance.

Possible project ideas:

- incident evidence board
- root-cause ranking workflow
- recovery planner
- runbook retrieval and summarization tool

## Where AI Can Help

You can use AI/ML, but keep it grounded in the data.

Good uses:

- anomaly detection
- ranking likely root causes
- retrieving the right runbook section
- predicting queue wait or failure risk
- summarizing evidence
- recommending an action from the action menu

A simple rules-based, retrieval-based, or optimization-based solution is completely acceptable if it works and explains itself.

## SQL Option

The package includes a public-only DuckDB database:

```text
ai_factory.duckdb
```

It contains the same public data as the CSV files, plus scenario-scoped views such as:

- `scenario_requests`
- `scenario_alerts`
- `scenario_node_metrics`
- `scenario_job_queue`
- `scenario_checkpoint_events`
- `scenario_storage_metrics`

Example Python usage:

```python
import duckdb

con = duckdb.connect("ai_factory.duckdb", read_only=True)
con.sql("SELECT * FROM scenario_signal_summary ORDER BY scenario_id").show()
```

If needed, install DuckDB with:

```bash
python3 -m pip install duckdb
```

See `example_queries.sql` for starter queries.

## Validate Recommendation Format

This checks format only:

```bash
python3 validate_recommendation.py data/public/sample_recommendations.json --require-all
```

For a single scenario recommendation:

```bash
python3 validate_recommendation.py path/to/recommendation.json
```

## Optional Baseline Summaries

```bash
python3 baseline_examples.py
```

These summaries are intentionally basic. They are only meant to help you understand the data.

## Judging

- 40% scenario recommendation
- 20% approach
- 15% evidence quality
- 15% usability and demo clarity
- 10% creativity or extension

The best projects make the next action clear and show why that action is supported by the data.

## What Not To Do

Avoid hardcoding recommendations by scenario ID, building a chatbot that does not use the data, showing charts without helping make a decision, requiring private credentials or external services to run, or requiring real GPUs.

Build something you would actually want to use if you were trying to keep an AI Factory healthy.
