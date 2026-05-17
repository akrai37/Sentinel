# Data Dictionary

## Public files

- `ai_factory.duckdb`: local DuckDB database containing the public CSV tables and scenario-scoped views.
- `example_queries.sql`: starter SQL queries for the DuckDB database.
- `gpu_nodes.csv`: static inventory. Every node represents one 8-GPU server.
- `model_profiles.csv`: serving capacity and SLO assumptions by model.
- `serving_replicas.csv`: model-level serving health, ready replicas, queue depth, batch size, and KV cache usage.
- `inference_requests.csv`: request-level traffic with latency, status code, batch, token, and node fields.
- `job_queue.csv`: training and batch jobs, including requested GPUs, requested nodes, priority, status, queue wait, and exit reason.
- `placement_snapshots.csv`: hourly node placement state, free GPUs, stranded GPUs, and queued large/high-priority jobs.
- `node_metrics.csv`: node utilization, memory, power, temperature, network throughput, ECC errors, and health state.
- `network_metrics.csv`: fabric/rack-level utilization, RDMA latency, retransmits, drops, and congestion state.
- `storage_metrics.csv`: storage service throughput, p95 latency, timeouts, and health state.
- `alerts.csv`: alerts emitted by services, nodes, storage, and scheduler.
- `logs.csv`: short service, node, and job log events.
- `checkpoint_events.csv`: checkpoint writes, durations, status, and timeout errors.
- `runbooks.md`: short troubleshooting notes for retrieval or rules.
- `scenario_signal_summary.csv`: beginner-friendly computed signals by scenario.
- `action_menu.csv`: allowed actions by track.
- `evaluation_scenarios.csv`: scenarios teams can evaluate in their prototypes.
- `sample_recommendations.json`: example structured recommendation output for the judging hook.
- `dataset_manifest.json`: metadata and row counts.

## Recommendation fields

- `scenario_id`: scenario from `evaluation_scenarios.csv`.
- `recommended_action`: one action from `action_menu.csv` for the scenario track.
- `target`: affected model, node, rack, job group, or service.
- `reason_category`: concise reason such as `memory_pressure`, `traffic_burst`, or `fragmentation`.
- `confidence`: free-form numeric confidence. The scorer validates presence, not calibration.
- `evidence`: one or more short evidence statements grounded in the data.
