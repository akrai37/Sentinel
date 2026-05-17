"use client";
import { useEffect, useMemo, useState } from "react";
import {
  escalateCiscoScenario,
  evaluateCiscoScenario,
  listCiscoScenarios,
  type CiscoRecommendation,
  type CiscoScenario,
} from "@/lib/api";

const DESTRUCTIVE_ACTIONS = new Set([
  "move_job",
  "restart_from_checkpoint",
  "rollback_config",
  "reroute_traffic",
  "reduce_load",
  "avoid_unhealthy_node",
]);

const TRACK_LABEL: Record<string, string> = {
  performance_advisor: "Performance Advisor",
  gpu_placement: "GPU Placement",
  failure_detective: "Failure Detective",
};

const TRACK_COLOR: Record<string, string> = {
  performance_advisor: "border-[#D49A1B]/40 bg-[#FBF1D6]/40",
  gpu_placement: "border-[#4F8C66]/40 bg-[#E6EFE9]/40",
  failure_detective: "border-[#B8422E]/40 bg-[#FCE9E2]/40",
};

interface CiscoPanelProps {
  onOpenWarroom?: (incidentId: string) => void;
}

export default function CiscoPanel({ onOpenWarroom }: CiscoPanelProps = {}) {
  const [scenarios, setScenarios] = useState<CiscoScenario[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [rec, setRec] = useState<CiscoRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [escalated, setEscalated] = useState<string | null>(null);
  const [escalating, setEscalating] = useState(false);

  useEffect(() => {
    listCiscoScenarios()
      .then((s) => {
        setScenarios(s);
        if (s.length && !selectedId) setSelectedId(s[0].scenario_id);
      })
      .catch((e) => setError(e?.message ?? String(e)));
  }, []);

  const selected = useMemo(
    () => scenarios.find((s) => s.scenario_id === selectedId),
    [scenarios, selectedId]
  );

  async function evaluate() {
    if (!selectedId) return;
    setLoading(true);
    setRec(null);
    setEscalated(null);
    try {
      const r = await evaluateCiscoScenario(selectedId);
      setRec(r);
    } finally {
      setLoading(false);
    }
  }

  async function pageOncall() {
    if (!selectedId) return;
    setEscalating(true);
    try {
      const r = await escalateCiscoScenario(selectedId);
      setEscalated(r?.ok ? `Posted to #incidents as ${r.posted_as_severity}` : "Failed to post");
    } finally {
      setEscalating(false);
    }
  }

  function openWarroom() {
    if (!selectedId || !onOpenWarroom) return;
    onOpenWarroom(`cisco-${selectedId}`);
  }

  const canEscalate = !!rec && !rec.error;
  const isDestructive = !!rec && DESTRUCTIVE_ACTIONS.has(rec.recommended_action);
  const isHighConfidence = !!rec && rec.confidence >= 0.8;

  if (error) {
    return (
      <div className="border border-[#B8422E]/40 bg-white rounded-[8px] p-4 text-sm text-[#B8422E]">
        Cisco data unavailable: {error}
      </div>
    );
  }

  return (
    <section className="bg-white border border-[#6C7278]/20 rounded-[8px] overflow-hidden">
      <header className="px-5 py-4 border-b border-[#6C7278]/20 flex items-center justify-between">
        <div>
          <div className="label-caps text-[#6C7278]">Cisco AI Factory · Failure Detective</div>
          <div className="text-sm text-[#6C7278]/80 mt-1">
            Pick a scenario from Cisco's dataset. Sentinel inspects alerts, logs,
            and runbooks then recommends a structured action.
          </div>
        </div>
        <div className="label-caps text-[#6C7278]">{scenarios.length} scenarios</div>
      </header>

      <div className="p-5 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-5">
        <div>
          <label className="label-caps text-[#6C7278] block mb-2">Scenario</label>
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setRec(null);
            }}
            className="w-full px-3 py-2 bg-white border border-[#6C7278]/30 rounded-[4px] text-sm font-mono"
          >
            {scenarios.map((s) => (
              <option key={s.scenario_id} value={s.scenario_id}>
                {s.scenario_id} · {TRACK_LABEL[s.track_id] ?? s.track_id}
              </option>
            ))}
          </select>

          {selected && (
            <div
              className={`mt-3 p-3 border rounded-[4px] text-xs ${TRACK_COLOR[selected.track_id]}`}
            >
              <div className="label-caps text-[#6C7278]/80 mb-1">
                {TRACK_LABEL[selected.track_id]}
              </div>
              <div className="text-[#1A1C1E]">
                <span className="font-semibold">{selected.focus_entity}</span>
              </div>
              <div className="text-[#6C7278] mt-1 leading-snug">{selected.prompt}</div>
              <div className="text-[#6C7278]/70 mt-2 text-[11px]">
                {selected.critical_alerts} critical alerts ·{" "}
                {selected.top_alert_types || "no alert pattern"}
              </div>
            </div>
          )}

          <button
            onClick={evaluate}
            disabled={loading || !selectedId}
            className="mt-3 w-full px-4 py-2 bg-[#1A1C1E] hover:bg-[#2A2C2E] text-white rounded-[4px] text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {loading ? "Evaluating…" : "Evaluate with Sentinel"}
          </button>
        </div>

        <div>
          <label className="label-caps text-[#6C7278] block mb-2">Recommendation</label>
          {!rec && !loading && (
            <div className="border border-dashed border-[#6C7278]/30 rounded-[4px] p-6 text-sm text-[#6C7278] text-center">
              Click "Evaluate with Sentinel" to generate a structured recommendation.
            </div>
          )}
          {loading && (
            <div className="border border-[#6C7278]/30 rounded-[4px] p-6 text-sm text-[#6C7278] text-center">
              Inspecting signals + runbook…
            </div>
          )}
          {rec && !rec.error && (
            <div className="space-y-3">
              {rec.reasoning && (
                <div className="p-4 bg-gradient-to-br from-[#1A1C1E] to-[#2A2C2E] text-white rounded-[6px] border border-[#1A1C1E]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="label-caps text-emerald-300">Sentinel's reasoning</span>
                  </div>
                  <p className="text-sm leading-relaxed text-[#F7F5F2]">{rec.reasoning}</p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 border border-[#6C7278]/20 rounded-[4px] bg-white">
                  <div className="label-caps text-[#6C7278]/70 mb-1">Action</div>
                  <div className="font-mono text-sm font-semibold text-[#B8422E]">{rec.recommended_action}</div>
                </div>
                <div className="p-3 border border-[#6C7278]/20 rounded-[4px] bg-white">
                  <div className="label-caps text-[#6C7278]/70 mb-1">Reason</div>
                  <div className="font-mono text-sm">{rec.reason_category}</div>
                </div>
                <div className="p-3 border border-[#6C7278]/20 rounded-[4px] bg-white">
                  <div className="label-caps text-[#6C7278]/70 mb-1">Confidence</div>
                  <div className="font-mono text-sm tabular-nums">{rec.confidence.toFixed(2)}</div>
                </div>
              </div>

              <div className="p-3 border border-[#6C7278]/20 rounded-[4px]">
                <div className="label-caps text-[#6C7278]/70 mb-1">Target</div>
                <div className="font-mono text-sm">{rec.target}</div>
              </div>

              <div className="p-3 border border-[#6C7278]/20 rounded-[4px]">
                <div className="flex items-center justify-between mb-2">
                  <span className="label-caps text-[#6C7278]/70">Evidence</span>
                  <span className="label-caps text-[#6C7278]/50">
                    {rec.used_llm ? "heuristic + LLM" : "heuristic only"}
                  </span>
                </div>
                <ol className="space-y-1.5 text-sm text-[#1A1C1E] list-decimal list-inside">
                  {rec.evidence.map((e, i) => (
                    <li key={i} className="leading-relaxed">
                      {e}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Escalation actions */}
              {canEscalate && (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    onClick={pageOncall}
                    disabled={escalating}
                    className="px-3 py-2 bg-[#1A1C1E] hover:bg-[#2A2C2E] text-white rounded-[4px] text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    {escalating ? "Posting…" : "📨 Page on-call (Stream)"}
                  </button>
                  {isDestructive && isHighConfidence && onOpenWarroom && (
                    <button
                      onClick={openWarroom}
                      className="px-3 py-2 bg-[#B8422E] hover:bg-[#9e3827] text-white rounded-[4px] text-sm font-semibold transition-colors"
                      title="Recommended action is destructive and high-confidence"
                    >
                      🎥 Open war room
                    </button>
                  )}
                  {escalated && (
                    <span className="text-xs text-emerald-700">✓ {escalated}</span>
                  )}
                </div>
              )}
            </div>
          )}
          {rec?.error && (
            <div className="border border-[#B8422E]/40 rounded-[4px] p-4 text-sm text-[#B8422E]">
              {rec.error}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
