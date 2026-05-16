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
  { label: string; accent: string; badge: string; cell: string; dot: string }
> = {
  critical: {
    label: "Critical",
    accent:
      "bg-gradient-to-br from-red-500/20 to-red-900/10 border-red-500/60 shadow-[0_0_24px_-12px_rgba(239,68,68,0.6)]",
    badge: "bg-red-500/20 text-red-200 border-red-500/60",
    cell: "bg-red-500/5",
    dot: "bg-red-400",
  },
  high: {
    label: "High",
    accent:
      "bg-gradient-to-br from-orange-500/15 to-orange-900/10 border-orange-500/50",
    badge: "bg-orange-500/20 text-orange-200 border-orange-500/50",
    cell: "",
    dot: "bg-orange-400",
  },
  medium: {
    label: "Medium",
    accent:
      "bg-gradient-to-br from-amber-500/15 to-amber-900/10 border-amber-500/40",
    badge: "bg-amber-500/15 text-amber-200 border-amber-500/40",
    cell: "",
    dot: "bg-amber-400",
  },
  low: {
    label: "Low",
    accent: "bg-slate-900/60 border-slate-700",
    badge: "bg-slate-700/40 text-slate-300 border-slate-600",
    cell: "",
    dot: "bg-slate-500",
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
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-900/60 border border-slate-800">
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          ok ? "bg-emerald-400" : "bg-slate-600"
        }`}
      />
      <span className="text-slate-400">{label}</span>
      {detail && <span className="text-slate-500">· {detail}</span>}
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
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(30,41,59,0.6),_rgba(2,6,23,1)_70%)] text-slate-100 font-mono">
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-500/40 to-red-700/20 border border-red-500/40 flex items-center justify-center">
                <span className="text-red-300 text-lg">◉</span>
              </div>
              <div className="absolute inset-0 rounded-lg bg-red-500/20 blur-md -z-10 animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Sentinel
                <span className="ml-2 text-xs font-normal text-slate-500 uppercase tracking-widest">
                  v0.1
                </span>
              </h1>
              <p className="text-slate-400 text-xs">
                Runtime firewall for AI agents — the Failure Detective for the AI Factory
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-slate-900/60 border border-slate-800">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                connected ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-slate-600"
              }`}
            />
            <span className="text-slate-300">
              {connected ? "live stream" : "disconnected"}
            </span>
          </div>
        </header>

        {/* Severity counters */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {(["critical", "high", "medium", "low"] as Severity[]).map((s) => {
            const meta = SEVERITY_META[s];
            return (
              <div
                key={s}
                className={`relative border rounded-xl p-4 transition-transform hover:scale-[1.02] ${meta.accent}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    {meta.label}
                  </span>
                </div>
                <div className="text-3xl font-bold tabular-nums">{counts[s]}</div>
                <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">
                  intercepted
                </div>
              </div>
            );
          })}
        </section>

        {/* Critical banner */}
        {latestCritical && stats?.trtc?.available && (
          <section className="relative mb-6 rounded-xl overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-red-600/30 via-red-500/15 to-transparent" />
            <div className="absolute inset-0 bg-red-500/5 animate-pulse" />
            <div className="relative border border-red-500/60 rounded-xl px-5 py-4 flex items-center gap-4 backdrop-blur-sm">
              <div className="text-2xl">🚨</div>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-red-300 font-bold">
                  Critical incident — auto-blocked
                </div>
                <div className="text-sm text-slate-100 mt-1">
                  <span className="text-slate-400">{latestCritical.call.agent_id}</span>
                  {" attempted "}
                  <span className="font-semibold text-red-200">
                    {latestCritical.call.tool_name}
                  </span>
                  <span className="text-slate-500"> · {latestCritical.assessment.category} · </span>
                  <span className="text-slate-300">
                    score {latestCritical.assessment.score.toFixed(2)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setWarroomFor(latestCritical.id)}
                className="px-4 py-2.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-bold whitespace-nowrap shadow-lg shadow-red-500/30 transition-colors"
              >
                🎥 Join war room
              </button>
            </div>
          </section>
        )}

        {/* Controls */}
        <section className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={fireDemoAttack}
            className="px-4 py-2 bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 rounded-lg text-sm font-bold shadow-lg shadow-red-500/20 transition-colors"
          >
            ▶ Fire demo attack
          </button>
          <button
            onClick={startTraffic}
            className="px-3 py-2 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded-lg text-sm text-slate-300"
          >
            Start traffic
          </button>
          <button
            onClick={stopTraffic}
            className="px-3 py-2 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded-lg text-sm text-slate-300"
          >
            Stop traffic
          </button>
          <button
            onClick={clearChat}
            className="px-3 py-2 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded-lg text-sm text-slate-300"
          >
            Clear chat
          </button>
        </section>

        {/* Main grid: events table + stream chat */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5">
          <section className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40 backdrop-blur-sm">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                Intercepted tool calls
              </div>
              <div className="text-[10px] text-slate-500">
                {events.length} events · hover for rationale
              </div>
            </div>
            <div className="max-h-[640px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-slate-500 text-[10px] uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Time</th>
                    <th className="text-left px-3 py-2 font-medium">Agent</th>
                    <th className="text-left px-3 py-2 font-medium">Tool</th>
                    <th className="text-left px-3 py-2 font-medium">Arguments</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Score</th>
                    <th className="text-left px-3 py-2 font-medium">Severity</th>
                    <th className="text-left px-3 py-2 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-16 text-slate-600">
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
                        className={`border-t border-slate-800/60 hover:bg-slate-800/40 cursor-help transition-colors ${meta.cell}`}
                      >
                        <td className="px-3 py-2 text-slate-500 tabular-nums">
                          {fmtTime(e.decided_at)}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{e.call.agent_id}</td>
                        <td className="px-3 py-2 font-semibold text-slate-100">
                          {e.call.tool_name}
                        </td>
                        <td className="px-3 py-2 text-slate-500 text-xs truncate max-w-xs">
                          {fmtArgs(e.call.arguments)}
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {e.assessment.category}
                        </td>
                        <td className="px-3 py-2 text-slate-200 tabular-nums">
                          {e.assessment.score.toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider ${meta.badge}`}
                          >
                            {e.severity}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              e.verdict === "block"
                                ? "text-red-400 font-medium"
                                : e.verdict === "pending_human"
                                ? "text-amber-300"
                                : "text-emerald-400/70"
                            }
                          >
                            {e.verdict}
                          </span>
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
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400 mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                #incidents · stream chat
              </div>
              <StreamPanel />
            </aside>
          )}
        </div>

        {/* Footer status bar */}
        <footer className="mt-6 flex flex-wrap items-center gap-2 text-[11px] border-t border-slate-800 pt-4">
          <StatusPill
            label="Ranker"
            ok={true}
            detail={stats?.llm.available ? "heuristics + Haiku" : "heuristics only"}
          />
          <StatusPill
            label="LLM"
            ok={stats?.llm.available}
            detail={
              stats?.llm.available ? `${stats.llm.cache_size} cached` : "offline"
            }
          />
          <StatusPill label="Stream" ok={stats?.stream?.available} />
          <StatusPill label="TRTC" ok={stats?.trtc?.available} />

          {evalM && (
            <div className="ml-auto inline-flex items-center gap-3 px-3 py-1.5 rounded-full bg-emerald-900/20 border border-emerald-700/40">
              <span className="text-emerald-300 text-[10px] uppercase tracking-wider font-bold">
                Eval · {evalM.total} examples
              </span>
              <span className="flex gap-3 text-emerald-200">
                <span>
                  P <span className="font-bold tabular-nums">{(evalM.precision * 100).toFixed(0)}%</span>
                </span>
                <span>
                  R <span className="font-bold tabular-nums">{(evalM.recall * 100).toFixed(0)}%</span>
                </span>
                <span>
                  F1 <span className="font-bold tabular-nums">{(evalM.f1 * 100).toFixed(0)}%</span>
                </span>
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
