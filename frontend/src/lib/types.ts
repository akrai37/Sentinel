export type Severity = "low" | "medium" | "high" | "critical";
export type Verdict = "allow" | "block" | "pending_human";

export interface ToolCall {
  id: string;
  agent_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  received_at: string;
}

export interface ThreatAssessment {
  score: number;
  category: string;
  rationale: string;
  matched_rules: string[];
}

export interface InterceptedEvent {
  id: string;
  call: ToolCall;
  assessment: ThreatAssessment;
  severity: Severity;
  verdict: Verdict;
  decided_at: string;
  escalation_channel: "none" | "stream" | "voiceos";
  human_decision: "pending" | "release" | "keep_blocked" | "approve" | "deny" | null;
}
