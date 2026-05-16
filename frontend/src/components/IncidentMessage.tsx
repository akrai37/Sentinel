"use client";
import { useState } from "react";
import { useMessageContext } from "stream-chat-react";
import { decideIncident, type IncidentAction } from "@/lib/api";

const SEV_BAR: Record<string, string> = {
  medium: "bg-[#6C7278]",
  high: "bg-[#1A1C1E]",
  critical: "bg-[#B8422E]",
};

export default function IncidentMessage() {
  const { message } = useMessageContext();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const d = message as unknown as Record<string, unknown>;
  const incidentId = d.sentinel_incident_id as string | undefined;
  const severity = (d.sentinel_severity ?? "low") as string;
  const category = d.sentinel_category as string | undefined;
  const score = d.sentinel_score as number | undefined;
  const tool = d.sentinel_tool as string | undefined;
  const agent = d.sentinel_agent as string | undefined;
  const verdict = d.sentinel_verdict as string | undefined;

  if (!incidentId) {
    return <div className="label-caps text-[#6C7278] px-3 py-2">{message.text}</div>;
  }

  async function act(action: IncidentAction) {
    if (!incidentId) return;
    setBusy(true);
    const r = await decideIncident(incidentId, action);
    setBusy(false);
    setResult(r?.ok ? `${action} applied` : `error: ${r?.error ?? "unknown"}`);
  }

  return (
    <div className="my-2 mx-2 bg-white border border-[#6C7278]/20 rounded-[8px] overflow-hidden flex">
      <div className={`w-[3px] flex-shrink-0 ${SEV_BAR[severity] ?? "bg-[#6C7278]/20"}`} />
      <div className="p-3 flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="label-caps text-[#6C7278]">{severity}</span>
          <span className="label-caps text-[#6C7278]/40 font-mono">{incidentId}</span>
        </div>
        <div className="text-sm font-semibold text-[#1A1C1E]">
          {tool}
          {agent && <span className="font-normal text-[#6C7278]"> · {agent}</span>}
        </div>
        <div className="label-caps text-[#6C7278] mt-1">
          {category} · score {score?.toFixed(2) ?? "—"} · {verdict}
        </div>
        <div className="text-xs text-[#6C7278] mt-2 leading-relaxed">{message.text}</div>
        <div className="flex gap-2 mt-3">
          <button
            disabled={busy}
            onClick={() => act("release")}
            className="px-2.5 py-1 label-caps text-white bg-[#1A1C1E] hover:bg-[#2d3035] rounded-[4px] disabled:opacity-40 transition-colors"
          >
            Release
          </button>
          <button
            disabled={busy}
            onClick={() => act("block")}
            className="px-2.5 py-1 label-caps text-white bg-[#6C7278] hover:bg-[#555b60] rounded-[4px] disabled:opacity-40 transition-colors"
          >
            Keep blocked
          </button>
          <button
            disabled={busy}
            onClick={() => act("escalate")}
            className="px-2.5 py-1 label-caps text-white bg-[#B8422E] hover:bg-[#9e3827] rounded-[4px] disabled:opacity-40 transition-colors"
          >
            Escalate
          </button>
          {result && (
            <span className="ml-auto label-caps text-[#6C7278] self-center">{result}</span>
          )}
        </div>
      </div>
    </div>
  );
}
