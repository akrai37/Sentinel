"use client";
import { useEffect, useState } from "react";
import { StreamChat, type Channel as StreamChannel } from "stream-chat";
import {
  Channel,
  ChannelHeader,
  Chat,
  MessageList,
  Window,
} from "stream-chat-react";
import "stream-chat-react/dist/css/index.css";

import { fetchStreamToken } from "@/lib/api";
import IncidentMessage from "./IncidentMessage";

export default function StreamPanel() {
  const [client, setClient] = useState<StreamChat | null>(null);
  const [channel, setChannel] = useState<StreamChannel | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let active: StreamChat | null = null;

    async function connect() {
      const t = await fetchStreamToken("oncall");
      if (cancelled) return;
      if (t.error) {
        setError(t.error);
        return;
      }
      const c = StreamChat.getInstance(t.api_key);
      active = c;
      await c.connectUser({ id: t.user_id, name: "On-call engineer" }, t.token);
      if (cancelled) {
        await c.disconnectUser();
        return;
      }
      const ch = c.channel(t.channel_type, t.channel_id);
      await ch.watch();
      setClient(c);
      setChannel(ch);
    }
    connect().catch((e) => setError(e?.message ?? String(e)));

    return () => {
      cancelled = true;
      active?.disconnectUser().catch(() => {});
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
    <div className="border border-slate-800 rounded-md overflow-hidden h-[600px] str-chat-dark">
      <Chat client={client} theme="str-chat__theme-dark">
        <Channel channel={channel}>
          <Window>
            <ChannelHeader />
            <MessageList Message={IncidentMessage} />
          </Window>
        </Channel>
      </Chat>
    </div>
  );
}
