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
    <div className="fixed inset-0 bg-[#1A1C1E]/70 z-50 flex items-center justify-center p-6">
      <div className="bg-[#F7F5F2] border border-[#6C7278]/20 rounded-[8px] w-full max-w-4xl overflow-hidden">

        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-[#6C7278]/20 bg-white overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#B8422E]" />
          <div className="pl-3">
            <div className="label-caps text-[#B8422E]">War room — critical incident</div>
            <div className="text-sm text-[#6C7278] mt-0.5">
              {bundle
                ? `${bundle.incident.agent} · ${bundle.incident.tool} · ${bundle.incident.category}`
                : "Connecting…"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-[#6C7278]/35 hover:border-[#6C7278] rounded-[4px] text-sm text-[#6C7278] transition-colors"
          >
            Leave room
          </button>
        </header>

        <div className="p-6 grid grid-cols-2 gap-6">
          {/* Left: incident brief + decision */}
          <div>
            <div className="label-caps text-[#6C7278] mb-3">Incident brief</div>
            {bundle ? (
              <div className="text-sm space-y-2">
                <div>
                  <span className="text-[#6C7278]">tool: </span>
                  <span className="font-semibold">{bundle.incident.tool}</span>
                </div>
                <div>
                  <span className="text-[#6C7278]">agent: </span>
                  {bundle.incident.agent}
                </div>
                <div>
                  <span className="text-[#6C7278]">score: </span>
                  {bundle.incident.score.toFixed(2)}{" · severity "}
                  <span className="text-[#B8422E] font-semibold">{bundle.incident.severity}</span>
                </div>
                <div className="text-[#6C7278] leading-relaxed pt-3 border-t border-[#6C7278]/15">
                  {bundle.incident.rationale}
                </div>
                <div className="mt-3 p-3 bg-white border border-[#6C7278]/15 rounded-[8px]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="label-caps text-[#6C7278]">Sentinel says</span>
                    <button
                      onClick={() => speak(briefText(bundle))}
                      className="label-caps text-[#6C7278] px-2 py-0.5 border border-[#6C7278]/30 hover:border-[#6C7278] rounded-[4px] transition-colors"
                    >
                      Replay
                    </button>
                  </div>
                  <div className="text-[#1A1C1E] text-sm italic leading-relaxed">
                    {briefText(bundle)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[#6C7278] text-sm">Loading incident…</div>
            )}

            {/* Decision */}
            <div className="mt-5 pt-4 border-t border-[#6C7278]/15">
              <div className="label-caps text-[#6C7278] mb-3">Decision</div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={startListening}
                  disabled={listening}
                  className={`px-3 py-2 rounded-[4px] text-sm font-semibold transition-colors ${
                    listening
                      ? "bg-[#B8422E] text-white"
                      : "border border-[#6C7278]/35 hover:border-[#6C7278] text-[#6C7278]"
                  }`}
                >
                  {listening ? "Listening…" : "Speak"}
                </button>
                <button
                  onClick={() => applyAction("release")}
                  className="px-3 py-2 bg-[#1A1C1E] hover:bg-[#2d3035] text-white rounded-[4px] text-sm font-semibold transition-colors"
                >
                  Release
                </button>
                <button
                  onClick={() => applyAction("block")}
                  className="px-3 py-2 bg-[#6C7278] hover:bg-[#555b60] text-white rounded-[4px] text-sm font-semibold transition-colors"
                >
                  Keep blocked
                </button>
                <button
                  onClick={() => applyAction("escalate")}
                  className="px-3 py-2 bg-[#B8422E] hover:bg-[#9e3827] text-white rounded-[4px] text-sm font-semibold transition-colors"
                >
                  Escalate
                </button>
              </div>
              {transcript && (
                <div className="mt-2 text-xs text-[#6C7278]">heard: {transcript}</div>
              )}
              {decision && (
                <div className="mt-2 text-sm font-semibold text-[#1A1C1E]">{decision.result}</div>
              )}
            </div>
          </div>

          {/* Right: video */}
          <div>
            <div className="label-caps text-[#6C7278] mb-3">
              Local video
              {state === "joined" && (
                <span className="text-emerald-600"> · connected</span>
              )}
            </div>
            <div
              ref={localVideoRef}
              className="bg-[#1A1C1E] rounded-[8px] aspect-video border border-[#6C7278]/15 flex items-center justify-center"
            >
              {state === "loading" && (
                <span className="label-caps text-[#6C7278]/50">Provisioning room…</span>
              )}
              {state === "joining" && (
                <span className="label-caps text-[#6C7278]/50">Joining TRTC room…</span>
              )}
              {state === "error" && (
                <span className="label-caps text-[#B8422E]">Error: {error}</span>
              )}
            </div>
            {bundle && (
              <div className="label-caps text-[#6C7278]/40 mt-2 font-mono break-all">
                room: {bundle.room_id}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
