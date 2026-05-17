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

export async function callOncall(incidentId: string) {
  const r = await fetch(`${API_BASE}/api/incidents/${incidentId}/call`, {
    method: "POST",
  });
  return r.json();
}

export interface CiscoScenario {
  scenario_id: string;
  track_id: "performance_advisor" | "gpu_placement" | "failure_detective";
  focus_entity: string;
  prompt: string;
  window: [string, string];
  critical_alerts: number;
  top_alert_types: string;
}

export interface CiscoRecommendation {
  scenario_id: string;
  recommended_action: string;
  target: string;
  reason_category: string;
  confidence: number;
  reasoning?: string;
  evidence: string[];
  used_llm: boolean;
  scenario: {
    track_id: string;
    focus_entity: string;
    prompt: string;
    window: [string, string];
  };
  error?: string;
}

export async function listCiscoScenarios(): Promise<CiscoScenario[]> {
  const r = await fetch(`${API_BASE}/api/cisco/scenarios`);
  return r.json();
}

export async function evaluateCiscoScenario(id: string): Promise<CiscoRecommendation> {
  const r = await fetch(`${API_BASE}/api/cisco/evaluate/${id}`, { method: "POST" });
  return r.json();
}

export async function escalateCiscoScenario(id: string) {
  const r = await fetch(`${API_BASE}/api/cisco/escalate/${id}`, { method: "POST" });
  return r.json();
}

export interface CiscoWarroomBundle extends WarroomBundle {}

export async function openCiscoWarroom(id: string): Promise<CiscoWarroomBundle> {
  const r = await fetch(`${API_BASE}/api/cisco/warroom/${id}`, { method: "POST" });
  return r.json();
}

export interface Stats {
  traffic_running: boolean;
  events_seen: number;
  llm: { available: boolean; model: string; cache_size: number };
  trtc?: { available: boolean };
  stream?: { available: boolean };
  twilio?: {
    available: boolean;
    from_number: string | null;
    oncall_number: string | null;
  };
  cisco?: { available: boolean; scenarios: number };
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
  // Cisco scenarios share the same WarRoom modal; route by id prefix.
  const path = incidentId.startsWith("cisco-")
    ? `/api/cisco/warroom/${incidentId.replace(/^cisco-/, "")}`
    : `/api/incidents/${incidentId}/warroom`;
  const r = await fetch(`${API_BASE}${path}`, { method: "POST" });
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
