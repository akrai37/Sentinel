"use client";
import { useEffect, useRef, useState } from "react";
import {
  decideIncident,
  openWarroom,
  type IncidentAction,
  type WarroomBundle,
} from "@/lib/api";

interface Props {
  incidentId: string;
  onClose: () => void;
}

type State = "loading" | "joining" | "joined" | "error";
type DecisionState = { action: IncidentAction; result: string } | null;

function briefText(b: WarroomBundle): string {
  return (
    `Sentinel here. Critical incident. Agent ${b.incident.agent} attempted ` +
    `${b.incident.tool}. ${b.incident.rationale} ` +
    `The action was auto-blocked. Say release, escalate, or take no action.`
  );
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.9;
  window.speechSynthesis.cancel();
  setTimeout(() => window.speechSynthesis.speak(u), 200);
}

function parseAction(transcript: string): IncidentAction | null {
  const t = transcript.toLowerCase();
  if (/\b(release|allow|unblock|let it through)\b/.test(t)) return "release";
  if (/\b(escalate|alert|page)\b/.test(t)) return "escalate";
  if (/\b(block|deny|keep blocked|stop)\b/.test(t)) return "block";
  return null;
}

// Minimal type for the Web Speech API (not in lib.dom.d.ts uniformly)
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function makeRecognizer(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "en-US";
  r.continuous = false;
  r.interimResults = false;
  return r;
}

export default function WarRoom({ incidentId, onClose }: Props) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string>("");
  const [bundle, setBundle] = useState<WarroomBundle | null>(null);
  const [decision, setDecision] = useState<DecisionState>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [listening, setListening] = useState(false);
  const trtcRef = useRef<{ exitRoom: () => Promise<void> } | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function join() {
      const b = await openWarroom(incidentId);
      if (cancelled) return;
      if (b.error) {
        setError(b.error);
        setState("error");
        return;
      }
      setBundle(b);
      setState("joining");

      try {
        const TRTC = (await import("trtc-sdk-v5")).default;
        const trtc = TRTC.create();
        trtcRef.current = trtc as unknown as { exitRoom: () => Promise<void> };
        await trtc.enterRoom({
          sdkAppId: b.sdk_app_id,
          userId: b.user_id,
          userSig: b.user_sig,
          strRoomId: b.room_id,
        });
        await trtc.startLocalAudio();
        if (localVideoRef.current) {
          await trtc.startLocalVideo({ view: localVideoRef.current });
        }
        if (cancelled) {
          await trtc.exitRoom();
          return;
        }
        setState("joined");
        speak(briefText(b));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setState("error");
      }
    }
    join();

    return () => {
      cancelled = true;
      trtcRef.current?.exitRoom().catch(() => {});
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [incidentId]);

  async function applyAction(action: IncidentAction) {
    const res = await decideIncident(incidentId, action);
    const ok = res?.ok === true;
    setDecision({
      action,
      result: ok ? `Applied: ${action}` : `Failed: ${res?.error ?? "unknown"}`,
    });
    speak(ok ? `Done. Incident ${action}d.` : "Sorry, that failed.");
  }

  function startListening() {
    const r = makeRecognizer();
    if (!r) {
      setTranscript("Browser doesn't support speech recognition. Use buttons.");
      return;
    }
    setTranscript("");
    setListening(true);
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setTranscript(text);
      const action = parseAction(text);
      if (action) {
        applyAction(action);
      } else {
        setTranscript(`Heard: "${text}" — didn't match release/block/escalate.`);
      }
    };
    r.onerror = (e) => {
      setTranscript(`Mic error: ${e.error ?? "unknown"}`);
      setListening(false);
    };
    r.onend = () => setListening(false);
    r.start();
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-red-500/40 rounded-lg w-full max-w-4xl overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-red-500/10">
          <div>
            <div className="text-xs uppercase tracking-wider text-red-300">
              War room — critical incident
            </div>
            <div className="text-sm text-slate-300 mt-0.5">
              {bundle
                ? `${bundle.incident.agent} · ${bundle.incident.tool} · ${bundle.incident.category}`
                : "Connecting…"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            Leave room
          </button>
        </header>

        <div className="p-5 grid grid-cols-2 gap-5">
          <div>
            <div className="text-xs uppercase text-slate-500 mb-2">Incident brief</div>
            {bundle ? (
              <div className="text-sm space-y-2">
                <div className="text-slate-100">
                  <span className="text-slate-500">tool:</span> {bundle.incident.tool}
                </div>
                <div className="text-slate-100">
                  <span className="text-slate-500">agent:</span> {bundle.incident.agent}
                </div>
                <div className="text-slate-100">
                  <span className="text-slate-500">score:</span>{" "}
                  {bundle.incident.score.toFixed(2)} · severity{" "}
                  <span className="text-red-300">{bundle.incident.severity}</span>
                </div>
                <div className="text-slate-300 leading-relaxed pt-2 border-t border-slate-800">
                  {bundle.incident.rationale}
                </div>
                <div className="mt-3 p-3 bg-slate-950/60 border border-slate-700 rounded">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs uppercase text-emerald-400">🔊 Sentinel says</div>
                    <button
                      onClick={() => speak(briefText(bundle))}
                      className="text-xs px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded"
                    >
                      Replay
                    </button>
                  </div>
                  <div className="text-slate-200 text-sm italic">{briefText(bundle)}</div>
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-sm">Loading incident…</div>
            )}

            {/* Decision area */}
            <div className="mt-4 border-t border-slate-800 pt-4">
              <div className="text-xs uppercase text-slate-500 mb-2">Decision</div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={startListening}
                  disabled={listening}
                  className={`px-3 py-2 rounded text-sm font-bold ${
                    listening
                      ? "bg-red-700 animate-pulse"
                      : "bg-purple-600 hover:bg-purple-500"
                  }`}
                  title="Hold to dictate: 'release', 'block', or 'escalate'"
                >
                  {listening ? "🎙️ Listening…" : "🎙️ Speak"}
                </button>
                <button
                  onClick={() => applyAction("release")}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-bold"
                >
                  ✓ Release
                </button>
                <button
                  onClick={() => applyAction("block")}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-500 rounded text-sm font-bold"
                >
                  ✋ Keep blocked
                </button>
                <button
                  onClick={() => applyAction("escalate")}
                  className="px-3 py-2 bg-red-700 hover:bg-red-600 rounded text-sm font-bold"
                >
                  ⚠ Escalate
                </button>
              </div>
              {transcript && (
                <div className="mt-2 text-xs text-slate-400">heard: {transcript}</div>
              )}
              {decision && (
                <div className="mt-2 text-sm text-emerald-300">{decision.result}</div>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase text-slate-500 mb-2">
              Local video{" "}
              {state === "joined" && (
                <span className="text-emerald-400">· connected</span>
              )}
            </div>
            <div
              ref={localVideoRef}
              className="bg-black rounded-md aspect-video border border-slate-800 flex items-center justify-center text-slate-600 text-xs"
            >
              {state === "loading" && "Provisioning room…"}
              {state === "joining" && "Joining TRTC room…"}
              {state === "error" && (
                <span className="text-red-400">Error: {error}</span>
              )}
            </div>
            {bundle && (
              <div className="text-xs text-slate-500 mt-2 font-mono break-all">
                room: {bundle.room_id}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
