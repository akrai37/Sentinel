"use client";
import { useEffect, useState } from "react";
import { StreamChat, type Channel as StreamChannel } from "stream-chat";
import {
  Channel,
  Chat,
  MessageList,
  Window,
} from "stream-chat-react";

function MinimalHeader() {
  return (
    <div className="px-4 py-3 border-b border-slate-800 bg-[#1a1c1e]/80">
      <div className="text-white text-sm font-semibold">Sentinel incidents</div>
      <div className="text-slate-500 text-[10px] uppercase tracking-wider mt-0.5">
        unified incident channel
      </div>
    </div>
  );
}
import "stream-chat-react/dist/css/index.css";

import { fetchStreamToken } from "@/lib/api";
import IncidentMessage from "./IncidentMessage";
import { StreamFilterContext, type StreamFilter } from "./StreamFilterContext";

const TABS: { id: StreamFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "agent", label: "Agent" },
  { id: "cisco", label: "Cisco" },
  { id: "escalations", label: "Escalations" },
];

export default function StreamPanel() {
  const [client, setClient] = useState<StreamChat | null>(null);
  const [channel, setChannel] = useState<StreamChannel | null>(null);
  const [error, setError] = useState<string>("");
  const [filter, setFilter] = useState<StreamFilter>("all");

  function downloadAllIncidents() {
    if (!channel) return;
    const messages = (channel.state?.messages ?? []).map((m) => ({
      id: m.id,
      created_at: m.created_at,
      user: m.user?.id,
      text: m.text,
      incident_id: (m as unknown as Record<string, unknown>).sentinel_incident_id,
      severity: (m as unknown as Record<string, unknown>).sentinel_severity,
      category: (m as unknown as Record<string, unknown>).sentinel_category,
      score: (m as unknown as Record<string, unknown>).sentinel_score,
      tool: (m as unknown as Record<string, unknown>).sentinel_tool,
      agent: (m as unknown as Record<string, unknown>).sentinel_agent,
      args: (m as unknown as Record<string, unknown>).sentinel_args,
      verdict: (m as unknown as Record<string, unknown>).sentinel_verdict,
      escalation: (m as unknown as Record<string, unknown>).sentinel_escalation === true,
    }));
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sentinel-incidents-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      const t = await fetchStreamToken("oncall");
      if (cancelled) return;
      if (t.error) {
        setError(t.error);
        return;
      }
      const c = StreamChat.getInstance(t.api_key);
      // getInstance returns a singleton; only connect if not already connected
      if (!c.userID) {
        await c.connectUser({ id: t.user_id, name: "On-call engineer" }, t.token);
      }
      if (cancelled) return;
      const ch = c.channel(t.channel_type, t.channel_id);
      await ch.watch();
      setClient(c);
      setChannel(ch);
    }
    connect().catch((e) => setError(e?.message ?? String(e)));

    // Do NOT disconnect on unmount — the singleton is reused on next mount
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="border border-slate-800 rounded-md p-4 text-xs text-red-400">
        Stream offline: {error}
      </div>
    );
  }
  if (!client || !channel) {
    return (
      <div className="border border-slate-800 rounded-md p-4 text-xs text-slate-500">
        Connecting to Stream…
      </div>
    );
  }

  return (
    <div className="border border-slate-800 rounded-md overflow-hidden h-[600px] str-chat-dark flex flex-col">
      <div className="flex gap-1 px-2 py-2 border-b border-slate-800 bg-[#1a1c1e]/60 items-center">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`px-3 py-1 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              filter === t.id
                ? t.id === "cisco"
                  ? "bg-[#D49A1B] text-white"
                  : t.id === "escalations"
                  ? "bg-[#B8422E] text-white"
                  : "bg-white text-[#1A1C1E]"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
        {filter === "all" && channel && (
          <button
            onClick={downloadAllIncidents}
            className="ml-auto w-7 h-7 flex items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-white rounded transition-colors"
            title="Download all incidents (agent + Cisco + escalations) as JSON"
            aria-label="Download incidents"
          >
            ⬇
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <StreamFilterContext.Provider value={filter}>
          <Chat client={client} theme="str-chat__theme-dark">
            <Channel channel={channel}>
              <Window>
                <MinimalHeader />
                <MessageList Message={IncidentMessage} />
              </Window>
            </Channel>
          </Chat>
        </StreamFilterContext.Provider>
      </div>
    </div>
  );
}
