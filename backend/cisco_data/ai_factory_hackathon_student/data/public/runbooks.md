# AI Factory Runbooks

These snippets are intentionally short. Teams can use keyword search, embeddings, rules, or a local LLM to retrieve the most relevant section.

## InferenceLatencyHigh

Check p95 latency, TTFT, queue wait, status codes, serving replica readiness, KV cache usage, and node memory utilization. If latency is tied to memory or oversized batches, reduce batch size or load. If latency is tied to fabric congestion or node health, reroute traffic.

## ReplicaErrorRateHigh

Compare status codes by model and time window. 429s usually indicate demand exceeding ready capacity or concurrency limits. 5xx errors after rollout logs may indicate a bad model, tokenizer, or serving configuration.

## MemoryPressureHigh

Look for high memory utilization, high KV cache usage, large batch size, and growing queue wait. The first mitigation is usually reducing batch size, lowering concurrency, or shifting traffic to healthier replicas.

## FabricCongestionHigh

Look at network p95 RDMA latency, retransmits, drops, and affected rack. If fabric congestion is localized, move or reroute work away from the affected rack and pause checkpoint-heavy jobs if they are contributing to traffic.

## QueueDepthHigh

Check requested GPUs, requested nodes, priority, queue wait, and placement snapshots. Large jobs need full 8-GPU nodes. Small jobs are useful backfill only when they do not block larger jobs.

## PriorityWaitHigh

High-priority jobs waiting behind lower-priority work should be moved forward. Evidence should include priority, queue wait, and the lower-priority work that is occupying capacity.

## MultiNodePlacementBlocked

Jobs requesting 16 or 32 GPUs require multiple 8-GPU nodes at the same time. Scattered free GPUs can look like idle capacity but still fail to admit a multi-node job.

## CheckpointWriteTimeout

Correlate checkpoint events, storage latency, timeout counts, job failures, and logs. Restart from the most recent checkpoint after the storage path recovers. Reduce checkpoint frequency or stagger checkpoint-heavy jobs if needed.

## NodeTemperatureHigh

Check temperature, power, active jobs, and whether new work is still landing on the node. Avoid new placements, move active jobs when needed, and reroute serving traffic away from the node.

## GpuXidEccError

GPU XID or ECC errors are node-local hardware fault signals. Move affected jobs away from the node and quarantine it from new placements until inspected.

## JobFailureCluster

When a few jobs fail without matching node, storage, network, or service-wide signals, avoid overreacting. Escalate to the job owner with logs and failed job IDs.
