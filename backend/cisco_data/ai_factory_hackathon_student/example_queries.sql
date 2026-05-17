-- AI Factory Ops example DuckDB queries
-- Run with:
--   duckdb ai_factory.duckdb < example_queries.sql
-- Or from Python:
--   import duckdb
--   con = duckdb.connect("ai_factory.duckdb", read_only=True)

-- 1. List the scenarios.
SELECT scenario_id, track_id, focus_entity, start_time, end_time, prompt
FROM evaluation_scenarios
ORDER BY scenario_id;

-- 2. Start with the beginner-friendly scenario summary.
SELECT *
FROM scenario_signal_summary
ORDER BY scenario_id;

-- 3. Performance Advisor: latency and errors by model for one scenario.
SELECT
  scenario_id,
  model_name,
  COUNT(*) AS requests,
  approx_quantile(latency_ms, 0.95) AS p95_latency_ms,
  SUM(CASE WHEN status_code != 200 THEN 1 ELSE 0 END) AS errors,
  SUM(CASE WHEN slo_violation THEN 1 ELSE 0 END) AS slo_violations
FROM scenario_requests
WHERE scenario_id = 'perf-001'
GROUP BY scenario_id, model_name
ORDER BY p95_latency_ms DESC;

-- 4. Performance Advisor: serving replica pressure in a scenario.
SELECT
  scenario_id,
  model_name,
  MAX(queued_requests) AS max_queued_requests,
  MAX(kv_cache_used_gb) AS max_kv_cache_used_gb,
  MAX(max_batch_size) AS max_batch_size,
  MAX(health_state) AS worst_reported_state
FROM scenario_serving_replicas
WHERE scenario_id = 'perf-001'
GROUP BY scenario_id, model_name
ORDER BY max_queued_requests DESC;

-- 5. GPU Placement Planner: queued jobs in a placement scenario.
SELECT
  scenario_id,
  priority,
  requested_gpus,
  COUNT(*) AS jobs,
  approx_quantile(queue_wait_min, 0.95) AS p95_queue_wait_min
FROM scenario_job_queue
WHERE scenario_id = 'gpu-001'
GROUP BY scenario_id, priority, requested_gpus
ORDER BY requested_gpus DESC, p95_queue_wait_min DESC;

-- 6. GPU Placement Planner: stranded GPUs by node.
SELECT
  scenario_id,
  node_id,
  MAX(stranded_gpus) AS max_stranded_gpus,
  MAX(queued_large_jobs) AS max_queued_large_jobs,
  MAX(free_gpus) AS max_free_gpus
FROM scenario_placement_snapshots
WHERE scenario_id = 'gpu-001'
GROUP BY scenario_id, node_id
ORDER BY max_stranded_gpus DESC, node_id;

-- 7. Failure Detective: alerts and logs for a failure scenario.
SELECT scenario_id, timestamp, severity, service, node_id, rack_id, model_name, alert_type, message
FROM scenario_alerts
WHERE scenario_id = 'fail-001'
ORDER BY timestamp;

-- 8. Failure Detective: checkpoint and storage signal.
WITH checkpoint_rollup AS (
  SELECT
    scenario_id,
    COUNT(*) FILTER (WHERE status != 'success') AS checkpoint_timeouts
  FROM scenario_checkpoint_events
  WHERE scenario_id = 'fail-001'
  GROUP BY scenario_id
),
storage_rollup AS (
  SELECT
    scenario_id,
    SUM(timeout_count) AS storage_timeouts,
    MAX(p95_latency_ms) AS max_storage_p95_latency_ms
  FROM scenario_storage_metrics
  WHERE scenario_id = 'fail-001'
  GROUP BY scenario_id
)
SELECT *
FROM checkpoint_rollup
JOIN storage_rollup USING (scenario_id);
