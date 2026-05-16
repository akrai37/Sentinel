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

const SEVERITY_STYLES: Record<Severity, string> = {
  low: "bg-slate-700/40 text-slate-200 border-slate-600",
  medium: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  high: "bg-orange-500/30 text-orange-100 border-orange-500/50",
  critical: "bg-red-500/30 text-red-100 border-red-500/60 animate-pulse",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

function fmtArgs(args: Record<string, unknown>) {
  const s = JSON.stringify(args);
  return s.length > 90 ? s.slice(0, 87) + "..." : s;
}

export default function Dashboard() {
  const { events, connected } = useEventStream();
  const [stats, setStats] = useState<Stats | null>(null);
  const [evalM, setEvalM] = useState<EvalMetrics | null>(null);

  useEffect(() => {
    fetchEval().then(setEvalM).catch(() => {});
    const t = setInterval(() => fetchStats().then(setStats).catch(() => {}), 3000);
    fetchStats().then(setStats).catch(() => {});
    return () => clearInterval(t);
  }, []);

  const [warroomFor, setWarroomFor] = useState<string | null>(null);

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
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 font-mono">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-red-400">●</span> Sentinel
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Runtime firewall for AI agents — the Failure Detective for the AI Factory
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? "bg-emerald-400" : "bg-slate-600"
            }`}
          />
          <span className="text-slate-400">
            {connected ? "live" : "disconnected"}
          </span>
        </div>
      </header>

      <section className="grid grid-cols-4 gap-3 mb-6">
        {(["critical", "high", "medium", "low"] as Severity[]).map((s) => (
          <div key={s} className={`border rounded-md p-4 ${SEVERITY_STYLES[s]}`}>
            <div className="text-xs uppercase tracking-wider opacity-70">{s}</div>
            <div className="text-3xl font-bold mt-1">{counts[s]}</div>
          </div>
        ))}
      </section>

      {latestCritical && stats?.trtc?.available && (
        <section className="mb-4 border border-red-500/50 bg-red-500/10 rounded-md px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-red-300">🚨 Critical incident — auto-blocked</div>
            <div className="text-sm text-slate-200 mt-1">
              {latestCritical.call.agent_id} attempted{" "}
              <span className="font-semibold">{latestCritical.call.tool_name}</span>{" "}
              · {latestCritical.assessment.category} · score {latestCritical.assessment.score.toFixed(2)}
            </div>
          </div>
          <button
            onClick={() => setWarroomFor(latestCritical.id)}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-sm font-bold whitespace-nowrap"
          >
            🎥 Join war room
          </button>
        </section>
      )}

      <section className="flex gap-2 mb-4">
        <button
          onClick={fireDemoAttack}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-sm font-bold"
        >
          ▶ Fire demo attack
        </button>
        <button
          onClick={startTraffic}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
        >
          Start traffic
        </button>
        <button
          onClick={stopTraffic}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
        >
          Stop traffic
        </button>
        <button
          onClick={clearChat}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
        >
          Clear chat
        </button>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      <section className="border border-slate-800 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Time</th>
              <th className="text-left px-3 py-2">Agent</th>
              <th className="text-left px-3 py-2">Tool</th>
              <th className="text-left px-3 py-2">Arguments</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Score</th>
              <th className="text-left px-3 py-2">Severity</th>
              <th className="text-left px-3 py-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-500">
                  Waiting for events…
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr
                key={e.id}
                title={`${e.assessment.rationale}\nrules: ${e.assessment.matched_rules.join(", ") || "—"}`}
                className="border-t border-slate-800 hover:bg-slate-900/50 cursor-help"
              >
                <td className="px-3 py-2 text-slate-400">{fmtTime(e.decided_at)}</td>
                <td className="px-3 py-2">{e.call.agent_id}</td>
                <td className="px-3 py-2 font-semibold">{e.call.tool_name}</td>
                <td className="px-3 py-2 text-slate-400 text-xs truncate max-w-xs">
                  {fmtArgs(e.call.arguments)}
                </td>
                <td className="px-3 py-2 text-slate-300">{e.assessment.category}</td>
                <td className="px-3 py-2">{e.assessment.score.toFixed(2)}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded border text-xs uppercase ${SEVERITY_STYLES[e.severity]}`}>
                    {e.severity}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      e.verdict === "block"
                        ? "text-red-400"
                        : e.verdict === "pending_human"
                        ? "text-amber-300"
                        : "text-slate-400"
                    }
                  >
                    {e.verdict}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {stats?.stream?.available && (
        <aside>
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            #incidents · stream chat
          </div>
          <StreamPanel />
        </aside>
      )}
      </div>

      <footer className="mt-6 flex flex-wrap items-center gap-4 text-xs text-slate-500 border-t border-slate-800 pt-4">
        <span>
          ranker:{" "}
          <span className="text-slate-300">
            heuristics{stats?.llm.available ? " + LLM (Haiku)" : ""}
          </span>
        </span>
        <span>
          LLM:{" "}
          <span className={stats?.llm.available ? "text-emerald-400" : "text-amber-400"}>
            {stats?.llm.available ? `online · ${stats.llm.cache_size} cached` : "offline (set ANTHROPIC_API_KEY)"}
          </span>
        </span>
        <span>
          stream:{" "}
          <span className={stats?.stream?.available ? "text-emerald-400" : "text-slate-500"}>
            {stats?.stream?.available ? "online" : "offline"}
          </span>
        </span>
        <span>
          TRTC:{" "}
          <span className={stats?.trtc?.available ? "text-emerald-400" : "text-slate-500"}>
            {stats?.trtc?.available ? "online" : "offline"}
          </span>
        </span>
        {evalM && (
          <span className="ml-auto">
            eval ({evalM.total} examples):{" "}
            <span className="text-emerald-300">
              precision {(evalM.precision * 100).toFixed(0)}%
            </span>
            {" · "}
            <span className="text-emerald-300">
              recall {(evalM.recall * 100).toFixed(0)}%
            </span>
            {" · "}
            <span className="text-slate-300">F1 {(evalM.f1 * 100).toFixed(0)}%</span>
          </span>
        )}
      </footer>

      {warroomFor && (
        <WarRoom incidentId={warroomFor} onClose={() => setWarroomFor(null)} />
      )}
    </main>
  );
}
