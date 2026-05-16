"use client";
import { useEffect, useMemo, useState } from "react";
import {
  clearChat,
  fetchEval,
  fetchStats,
  fireDemoAttack,
  startTraffic,
  stopTraffic,
  type EvalMetrics,
  type Stats,
} from "@/lib/api";
import { useEventStream } from "@/lib/useEventStream";
import type { Severity } from "@/lib/types";
import WarRoom from "@/components/WarRoom";
import dynamic from "next/dynamic";
const StreamPanel = dynamic(() => import("@/components/StreamPanel"), { ssr: false });

const SEVERITY_META: Record<
  Severity,
  { label: string; dot: string; bar: string; badge: string; row: string }
> = {
  critical: {
    label: "Critical",
    dot: "bg-[#B8422E]",
    bar: "bg-[#B8422E]",
    badge: "bg-[#B8422E] text-white",
    row: "bg-[#B8422E]/[0.03]",
  },
  high: {
    label: "High",
    dot: "bg-[#1A1C1E]",
    bar: "bg-[#1A1C1E]",
    badge: "bg-[#1A1C1E] text-white",
    row: "",
  },
  medium: {
    label: "Medium",
    dot: "bg-[#6C7278]",
    bar: "bg-[#6C7278]",
    badge: "bg-[#6C7278] text-white",
    row: "",
  },
  low: {
    label: "Low",
    dot: "bg-[#6C7278]/30",
    bar: "bg-[#6C7278]/20",
    badge: "border border-[#6C7278]/40 text-[#6C7278]",
    row: "",
  },
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

function fmtArgs(args: Record<string, unknown>) {
  const s = JSON.stringify(args);
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

function StatusPill({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean | undefined;
  detail?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border border-[#6C7278]/25 bg-white/70">
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          ok ? "bg-emerald-500" : "bg-[#6C7278]/30"
        }`}
      />
      <span className="label-caps text-[#6C7278]">{label}</span>
      {detail && <span className="label-caps text-[#6C7278]/50">· {detail}</span>}
    </span>
  );
}

export default function Dashboard() {
  const { events, connected } = useEventStream();
  const [stats, setStats] = useState<Stats | null>(null);
  const [evalM, setEvalM] = useState<EvalMetrics | null>(null);
  const [warroomFor, setWarroomFor] = useState<string | null>(null);

  useEffect(() => {
    fetchEval().then(setEvalM).catch(() => {});
    fetchStats().then(setStats).catch(() => {});
    const t = setInterval(() => fetchStats().then(setStats).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const e of events) c[e.severity]++;
    return c;
  }, [events]);

  const latestCritical = useMemo(
    () => events.find((e) => e.severity === "critical"),
    [events]
  );

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-[#1A1C1E]">
      <div className="max-w-[1400px] mx-auto px-6 py-8">

        {/* Header */}
        <header className="flex items-center justify-between mb-10 pb-6 border-b border-[#6C7278]/20">
          <div>
            <h1 className="text-4xl font-bold tracking-tight leading-none">Sentinel</h1>
            <p className="text-[#6C7278] text-sm mt-2">
              Runtime firewall for AI agents — the Failure Detective for the AI Factory
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-[4px] border border-[#6C7278]/25 bg-white/70">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                connected ? "bg-emerald-500" : "bg-[#6C7278]/30"
              }`}
            />
            <span className="label-caps text-[#6C7278]">
              {connected ? "Live" : "Disconnected"}
            </span>
          </div>
        </header>

        {/* Severity counters */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {(["critical", "high", "medium", "low"] as Severity[]).map((s) => {
            const meta = SEVERITY_META[s];
            return (
              <div
                key={s}
                className="bg-white border border-[#6C7278]/15 rounded-[8px] overflow-hidden flex"
              >
                <div className={`w-[3px] flex-shrink-0 ${meta.bar}`} />
                <div className="p-5 flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    <span className="label-caps text-[#6C7278]">{meta.label}</span>
                  </div>
                  <div className="text-4xl font-bold tabular-nums">{counts[s]}</div>
                  <div className="label-caps text-[#6C7278]/50 mt-2">intercepted</div>
                </div>
              </div>
            );
          })}
        </section>

        {/* Critical banner */}
        {latestCritical && stats?.trtc?.available && (
          <section className="mb-8 bg-white border border-[#6C7278]/15 rounded-[8px] overflow-hidden flex">
            <div className="w-[3px] flex-shrink-0 bg-[#B8422E]" />
            <div className="px-5 py-4 flex items-center gap-4 flex-1">
              <div className="flex-1">
                <div className="label-caps text-[#B8422E] mb-1">
                  Critical incident — auto-blocked
                </div>
                <div className="text-sm">
                  <span className="text-[#6C7278]">{latestCritical.call.agent_id}</span>
                  {" attempted "}
                  <span className="font-semibold">{latestCritical.call.tool_name}</span>
                  <span className="text-[#6C7278]">
                    {" · "}{latestCritical.assessment.category}
                    {" · score "}{latestCritical.assessment.score.toFixed(2)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setWarroomFor(latestCritical.id)}
                className="px-4 py-2 bg-[#B8422E] hover:bg-[#9e3827] text-white rounded-[4px] text-sm font-semibold whitespace-nowrap transition-colors"
              >
                Join war room
              </button>
            </div>
          </section>
        )}

        {/* Controls */}
        <section className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={fireDemoAttack}
            className="px-4 py-2 bg-[#B8422E] hover:bg-[#9e3827] text-white rounded-[4px] text-sm font-semibold transition-colors"
          >
            Fire demo attack
          </button>
          <button
            onClick={startTraffic}
            className="px-3 py-2 border border-[#6C7278]/35 hover:border-[#6C7278] rounded-[4px] text-sm text-[#6C7278] transition-colors"
          >
            Start traffic
          </button>
          <button
            onClick={stopTraffic}
            className="px-3 py-2 border border-[#6C7278]/35 hover:border-[#6C7278] rounded-[4px] text-sm text-[#6C7278] transition-colors"
          >
            Stop traffic
          </button>
          <button
            onClick={clearChat}
            className="px-3 py-2 border border-[#6C7278]/35 hover:border-[#6C7278] rounded-[4px] text-sm text-[#6C7278] transition-colors"
          >
            Clear chat
          </button>
        </section>

        {/* Main grid: events table + stream chat */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5">
          <section className="bg-white border border-[#6C7278]/15 rounded-[8px] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#6C7278]/15 flex items-center justify-between">
              <span className="label-caps text-[#6C7278]">Intercepted tool calls</span>
              <span className="label-caps text-[#6C7278]/40">
                {events.length} events · hover for rationale
              </span>
            </div>
            <div className="max-h-[640px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F7F5F2] sticky top-0 z-10">
                  <tr>
                    {["Time", "Agent", "Tool", "Category", "Score", "Severity", "Verdict", "Arguments"].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2.5 label-caps text-[#6C7278]"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-16 label-caps text-[#6C7278]/30">
                        Waiting for events…
                      </td>
                    </tr>
                  )}
                  {events.map((e) => {
                    const meta = SEVERITY_META[e.severity];
                    return (
                      <tr
                        key={e.id}
                        title={`${e.assessment.rationale}\nrules: ${
                          e.assessment.matched_rules.join(", ") || "—"
                        }`}
                        className={`border-t border-[#6C7278]/10 hover:bg-[#F7F5F2]/70 cursor-help transition-colors ${meta.row}`}
                      >
                        <td className="px-3 py-2.5 text-[#6C7278] tabular-nums text-xs">
                          {fmtTime(e.decided_at)}
                        </td>
                        <td className="px-3 py-2.5 text-[#6C7278]">{e.call.agent_id}</td>
                        <td className="px-3 py-2.5 font-semibold">{e.call.tool_name}</td>
                        <td className="px-3 py-2.5 text-[#6C7278]">
                          {e.assessment.category}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums font-semibold">
                          {e.assessment.score.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded-[4px] label-caps ${meta.badge}`}
                          >
                            {e.severity}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={
                              e.verdict === "block"
                                ? "text-[#B8422E] font-semibold"
                                : e.verdict === "pending_human"
                                ? "text-[#6C7278]"
                                : "text-[#6C7278]/40"
                            }
                          >
                            {e.verdict}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[#6C7278] text-xs truncate max-w-xs font-mono">
                          {fmtArgs(e.call.arguments)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {stats?.stream?.available && (
            <aside>
              <div className="label-caps text-[#6C7278] mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                #incidents · stream chat
              </div>
              <StreamPanel />
            </aside>
          )}
        </div>

        {/* Footer status bar */}
        <footer className="mt-8 flex flex-wrap items-center gap-2 border-t border-[#6C7278]/20 pt-5">
          <StatusPill
            label="Ranker"
            ok={true}
            detail={stats?.llm.available ? "heuristics + Haiku" : "heuristics only"}
          />
          <StatusPill
            label="LLM"
            ok={stats?.llm.available}
            detail={stats?.llm.available ? `${stats.llm.cache_size} cached` : "offline"}
          />
          <StatusPill label="Stream" ok={stats?.stream?.available} />
          <StatusPill label="TRTC" ok={stats?.trtc?.available} />

          {evalM && (
            <div className="ml-auto inline-flex items-center gap-3 px-3 py-1.5 rounded-[4px] border border-[#6C7278]/20 bg-white/70">
              <span className="label-caps text-[#6C7278]">
                Eval · {evalM.total} examples
              </span>
              <span className="flex gap-3 label-caps text-[#1A1C1E]">
                <span>P <span className="font-bold tabular-nums">{(evalM.precision * 100).toFixed(0)}%</span></span>
                <span>R <span className="font-bold tabular-nums">{(evalM.recall * 100).toFixed(0)}%</span></span>
                <span>F1 <span className="font-bold tabular-nums">{(evalM.f1 * 100).toFixed(0)}%</span></span>
              </span>
            </div>
          )}
        </footer>
      </div>

      {warroomFor && (
        <WarRoom incidentId={warroomFor} onClose={() => setWarroomFor(null)} />
      )}
    </main>
  );
}
