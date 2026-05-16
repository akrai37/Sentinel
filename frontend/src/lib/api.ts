export const API_BASE =
  process.env.NEXT_PUBLIC_SENTINEL_API ?? "http://localhost:8000";

export async function fireDemoAttack() {
  await fetch(`${API_BASE}/api/demo/attack`, { method: "POST" });
}

export async function startTraffic() {
  await fetch(`${API_BASE}/api/demo/traffic/start`, { method: "POST" });
}

export async function stopTraffic() {
  await fetch(`${API_BASE}/api/demo/traffic/stop`, { method: "POST" });
}

export interface Stats {
  traffic_running: boolean;
  events_seen: number;
  llm: { available: boolean; model: string; cache_size: number };
}

export interface EvalMetrics {
  total: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

export async function fetchStats(): Promise<Stats> {
  return (await fetch(`${API_BASE}/api/stats`)).json();
}

export async function fetchEval(): Promise<EvalMetrics> {
  return (await fetch(`${API_BASE}/api/eval`)).json();
}
