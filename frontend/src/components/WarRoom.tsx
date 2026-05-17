"use client";
import { useEffect, useRef, useState } from "react";
import {
  createMeetWarroom,
  decideIncident,
  openWarroom,
  type IncidentAction,
  type WarroomBundle,
} from "@/lib/api";

interface Props {
  incidentId: string;
  onClose: () => void;
  onEscalate?: (incidentId: string) => void;
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

export default function WarRoom({ incidentId, onClose, onEscalate }: Props) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string>("");
  const [bundle, setBundle] = useState<WarroomBundle | null>(null);
  const [decision, setDecision] = useState<DecisionState>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [listening, setListening] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(
    new Set(["chu2@scu.edu", "hgarude@scu.edu"])
  );
  const [extraEmail, setExtraEmail] = useState<string>("");
  const [inviteSent, setInviteSent] = useState<string | null>(null);

  const PRESET_EMAILS = ["chu2@scu.edu", "hgarude@scu.edu"];

  function toggleEmail(email: string) {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }
  const [meetLink, setMeetLink] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function join() {
      // Best-effort pull of incident context; if the live bus has aged
      // this incident out we still want to open the Meet war room.
      let b: WarroomBundle | null = null;
      try {
        const ctx = await openWarroom(incidentId);
        if (!cancelled && !ctx.error) {
          b = ctx;
          setBundle(ctx);
        }
      } catch {
        // ignore; Meet flow doesn't depend on this
      }
      if (cancelled) return;
      setState("joining");

      // Provision the Google Meet war room (do not auto-open — engineer
      // clicks the link when ready)
      try {
        const meet = await createMeetWarroom(incidentId);
        if (cancelled) return;
        if (meet?.meet_link) {
          setMeetLink(meet.meet_link);
        }
        setState("joined");
        if (b) speak(briefText(b));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setState("error");
      }
    }
    join();

    return () => {
      cancelled = true;
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
    if (ok && action === "escalate") {
      onEscalate?.(incidentId);
    }
  }

  function inviteUrl(): string {
    if (typeof window === "undefined") return "";
    // Use the LAN host so the link works from other devices on the same wifi,
    // not just from this machine's localhost. Override with NEXT_PUBLIC_INVITE_HOST.
    const lanHost =
      process.env.NEXT_PUBLIC_INVITE_HOST ?? "192.168.56.1:3000";
    const u = new URL(window.location.href);
    u.host = lanHost;
    u.protocol = "http:";
    u.searchParams.set("warroom", incidentId);
    return u.toString();
  }

  function sendInvite() {
    const recipients = Array.from(selectedEmails);
    const extra = (extraEmail || "").trim();
    if (extra && /\S+@\S+\.\S+/.test(extra)) recipients.push(extra);
    if (recipients.length === 0) {
      setInviteSent("Pick at least one recipient");
      return;
    }
    const url = inviteUrl();
    const subject = encodeURIComponent(
      `Sentinel war room — incident ${incidentId}`
    );
    const body = encodeURIComponent(
      `You're invited to a Sentinel war room.\n\n` +
      `Incident: ${incidentId}\n` +
      (bundle ? `Tool: ${bundle.incident.tool}\nAgent: ${bundle.incident.agent}\nRationale: ${bundle.incident.rationale}\n\n` : "\n") +
      `Click to join: ${url}\n`
    );
    const to = recipients.map((r) => encodeURIComponent(r)).join(",");
    const href = `mailto:${to}?subject=${subject}&body=${body}`;
    // Use a programmatic anchor click — most reliable across browsers/OSes
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    a.target = "_self";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setInviteSent(`Mail draft opened for ${recipients.length} recipient${recipients.length > 1 ? "s" : ""} — if nothing happened, set a default mail app or use Copy link`);
  }

  function copyLink() {
    if (typeof window === "undefined") return;
    navigator.clipboard?.writeText(inviteUrl()).then(
      () => setInviteSent("Invite link copied"),
      () => setInviteSent("Copy failed; select the URL bar manually"),
    );
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
            ) : state === "joined" ? (
              <div className="text-[#6C7278] text-sm italic">
                Incident context not in live event bus (likely from a previous run). The Meet
                war room is still open below — engineers can join, discuss, and act.
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

          {/* Right: Google Meet panel */}
          <div>
            <div className="label-caps text-[#6C7278] mb-3">
              Google Meet
              {state === "joined" && meetLink && (
                <span className="text-emerald-600"> · open in new tab</span>
              )}
            </div>
            <div className="bg-gradient-to-br from-[#E6F4EA] to-white rounded-[8px] aspect-video border border-[#1A8754]/30 flex flex-col items-center justify-center p-4">
              {state === "loading" && (
                <span className="label-caps text-[#6C7278]/50">Provisioning Meet…</span>
              )}
              {state === "joining" && (
                <span className="label-caps text-[#6C7278]/50">Opening Meet…</span>
              )}
              {state === "joined" && meetLink && (
                <>
                  <div className="text-4xl mb-2">🟢</div>
                  <div className="text-sm text-[#1A1C1E] font-semibold mb-3">
                    Meet war room is ready
                  </div>
                  <a
                    href={meetLink}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#1A8754] hover:bg-[#157148] text-white rounded-[4px] text-sm font-semibold transition-colors"
                  >
                    Open Meet
                  </a>
                  <div className="text-[10px] font-mono text-[#1A8754]/70 mt-2 break-all px-2 text-center">
                    {meetLink}
                  </div>
                </>
              )}
              {state === "error" && (
                <span className="label-caps text-[#B8422E]">Error: {error}</span>
              )}
            </div>

            {/* Invite */}
            <div className="mt-4 pt-4 border-t border-[#6C7278]/15">
              <div className="label-caps text-[#6C7278] mb-2">Invite responders</div>
              <div className="space-y-1.5 mb-2">
                {PRESET_EMAILS.map((email) => (
                  <label
                    key={email}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:text-[#1A1C1E] text-[#6C7278]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmails.has(email)}
                      onChange={() => toggleEmail(email)}
                      className="accent-[#1A1C1E]"
                    />
                    <span className="font-mono">{email}</span>
                  </label>
                ))}
              </div>
              <input
                type="email"
                placeholder="add another email (optional)"
                value={extraEmail}
                onChange={(e) => setExtraEmail(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-[#6C7278]/30 rounded-[4px] text-sm bg-white font-mono mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={sendInvite}
                  className="flex-1 px-3 py-1.5 bg-[#1A1C1E] hover:bg-[#2d3035] text-white rounded-[4px] text-sm font-semibold transition-colors"
                >
                  Email invite
                </button>
                <button
                  onClick={copyLink}
                  className="px-3 py-1.5 border border-[#6C7278]/35 hover:border-[#6C7278] rounded-[4px] text-sm text-[#6C7278] transition-colors"
                  title="Copy join link to clipboard"
                >
                  Copy link
                </button>
              </div>
              {inviteSent && (
                <div className="mt-2 text-xs text-emerald-700">✓ {inviteSent}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
