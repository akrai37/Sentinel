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

export async function clearChat() {
  await fetch(`${API_BASE}/api/demo/clear_chat`, { method: "POST" });
}

export interface Stats {
  traffic_running: boolean;
  events_seen: number;
  llm: { available: boolean; model: string; cache_size: number };
  trtc?: { available: boolean };
  stream?: { available: boolean };
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

export interface WarroomBundle {
  sdk_app_id: number;
  room_id: string;
  user_id: string;
  user_sig: string;
  incident: {
    id: string;
    tool: string;
    agent: string;
    category: string;
    rationale: string;
    score: number;
    severity: string;
  };
  error?: string;
}

export async function openWarroom(incidentId: string): Promise<WarroomBundle> {
  const r = await fetch(`${API_BASE}/api/incidents/${incidentId}/warroom`, {
    method: "POST",
  });
  return r.json();
}

export type IncidentAction = "release" | "block" | "escalate";

export async function decideIncident(incidentId: string, action: IncidentAction) {
  const r = await fetch(`${API_BASE}/api/incidents/${incidentId}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return r.json();
}

export interface StreamToken {
  api_key: string;
  user_id: string;
  token: string;
  channel_type: string;
  channel_id: string;
  error?: string;
}

export async function fetchStreamToken(userId = "oncall"): Promise<StreamToken> {
  const r = await fetch(`${API_BASE}/api/stream/token?user_id=${encodeURIComponent(userId)}`);
  return r.json();
}
