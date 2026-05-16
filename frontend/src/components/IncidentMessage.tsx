"use client";
import { useState } from "react";
import { useMessageContext } from "stream-chat-react";
import { decideIncident, type IncidentAction } from "@/lib/api";

const SEV_STYLE: Record<string, string> = {
  medium: "border-amber-500/50 bg-amber-500/10",
  high: "border-orange-500/50 bg-orange-500/10",
  critical: "border-red-500/60 bg-red-500/10",
};

export default function IncidentMessage() {
  const { message } = useMessageContext();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const incidentId = (message as unknown as Record<string, unknown>).sentinel_incident_id as
    | string
    | undefined;
  const severity = ((message as unknown as Record<string, unknown>).sentinel_severity ?? "low") as string;
  const category = (message as unknown as Record<string, unknown>).sentinel_category as string | undefined;
  const score = (message as unknown as Record<string, unknown>).sentinel_score as number | undefined;
  const tool = (message as unknown as Record<string, unknown>).sentinel_tool as string | undefined;
  const agent = (message as unknown as Record<string, unknown>).sentinel_agent as string | undefined;
  const verdict = (message as unknown as Record<string, unknown>).sentinel_verdict as string | undefined;

  if (!incidentId) {
    // Fallback for non-incident messages (e.g. channel system messages)
    return (
      <div className="text-xs text-slate-500 px-3 py-2">{message.text}</div>
    );
  }

  async function act(action: IncidentAction) {
    if (!incidentId) return;
    setBusy(true);
    const r = await decideIncident(incidentId, action);
    setBusy(false);
    setResult(r?.ok ? `${action} applied` : `error: ${r?.error ?? "unknown"}`);
  }

  return (
    <div className={`my-2 mx-2 border rounded-md p-3 ${SEV_STYLE[severity] ?? "border-slate-700"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wider text-slate-200">
          {severity}
        </span>
        <span className="text-xs text-slate-400 font-mono">{incidentId}</span>
      </div>
      <div className="text-sm text-slate-100">
        <span className="font-semibold">{tool}</span>
        {agent && <span className="text-slate-400"> · {agent}</span>}
      </div>
      <div className="text-xs text-slate-300 mt-1">
        {category} · score {score?.toFixed(2) ?? "—"} · verdict {verdict}
      </div>
      <div className="text-xs text-slate-400 mt-2 leading-snug">{message.text}</div>
      <div className="flex gap-2 mt-3">
        <button
          disabled={busy}
          onClick={() => act("release")}
          className="px-2 py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 rounded disabled:opacity-50"
        >
          Release
        </button>
        <button
          disabled={busy}
          onClick={() => act("block")}
          className="px-2 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-500 rounded disabled:opacity-50"
        >
          Keep blocked
        </button>
        <button
          disabled={busy}
          onClick={() => act("escalate")}
          className="px-2 py-1 text-xs font-bold bg-red-700 hover:bg-red-600 rounded disabled:opacity-50"
        >
          Escalate
        </button>
        {result && <span className="ml-auto text-xs text-emerald-300 self-center">{result}</span>}
      </div>
    </div>
  );
}
