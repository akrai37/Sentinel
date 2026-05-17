# Sentinel

**Runtime firewall for AI agents. PagerDuty for the AI Factory.**

Sentinel intercepts every tool call an AI agent wants to make, scores the risk, and either blocks the action or escalates to a human. The escalation surface scales with the threat: silent log, chat thread, voice triage, or full video war room.

Built for Hack-A-Stack 2026 at Santa Clara University.

---

## The problem

AI agents now have production access. Databases, file systems, code execution, the same permissions as a senior engineer. They fail in new ways: prompt injections hijack behavior through poisoned documents, runaway loops burn compute, hallucinated commands drop tables. These failures look like ordinary agent activity in logs, and by the time a human notices, the damage is done.

Existing tools either log threats after the fact (LangSmith, Helicone) or flag them without acting (Lakera, NeMo, Llama Guard). Sentinel sits inline and actually stops things from happening.

## How it works

```
┌────────────┐   tool call   ┌──────────────────┐   verdict   ┌──────────────┐
│ MCP client │ ───────────▶  │  Sentinel        │ ◀────────── │ Policy Engine│
│ (Cursor /  │ ◀───────────  │  Interceptor     │             └──────┬───────┘
│  Claude)   │   response    └────────┬─────────┘                    │
└────────────┘                        │                              │
                                      ▼                              │
                            ┌──────────────────┐                     │
                            │  Threat Ranker   │                     │
                            │  Tier A: regex   │                     │
                            │  Tier B: Haiku   │                     │
                            └────────┬─────────┘                     │
                                     │ score + rationale             │
                                     ▼                               │
                            ┌──────────────────┐                     │
                            │ Severity Router  │ ─────────────────── ┘
                            └────────┬─────────┘
              ┌───────────────┬──────┴────────┬─────────────────┐
              ▼               ▼               ▼                 ▼
          log only      Stream chat      VoiceOS MCP        TRTC war room
          (low)         (medium)         (high)             (critical)
```

## Severity routing

| Tier      | Surface                                                       | Sponsor          |
| --------- | ------------------------------------------------------------- | ---------------- |
| Low       | Dashboard log only                                            | -                |
| Medium    | Auto created incident channel with approve / deny buttons     | **Stream**       |
| High      | Voice triage via MCP, ask Sentinel and tell it what to do     | **VoiceOS**      |
| Critical  | Auto spawned video war room any responder can join            | **Tencent TRTC** |

Plus **Anthropic Claude Haiku** powering the LLM tier of the ranker.

## Demo flow

1. Dashboard streams intercepted events in real time
2. Click `Fire demo attack`. An agent attempts `DROP TABLE users`
3. Ranker scores it 0.97, policy auto blocks, severity routes to Critical
4. Red banner appears with a `Join war room` button
5. Click it. TRTC video opens, browser TTS reads the incident brief
6. Engineer clicks Release, Keep blocked, or Escalate. Verdict propagates back to the dashboard and the Stream channel in real time

In parallel, ask VoiceOS from another window: *"what's the latest critical?"* It reads the incident aloud through our MCP server.

## Eval

A 36 example labeled set runs on server boot. Live metrics show in the dashboard footer.

Current numbers:

| Metric    | Heuristics only | + LLM (Haiku) |
| --------- | --------------- | ------------- |
| Precision | 100%            | **100%**      |
| Recall    | 84%             | **95%**       |
| F1        | 0.91            | **0.97**      |

Run manually:

```bash
cd backend
source .venv/bin/activate
python -m app.eval.harness
```

## Architecture decisions

**Two tier ranker.** Most traffic resolves at Tier A (regex heuristics) in microseconds. Only the ambiguous band (score roughly 0.20-0.70) escalates to Tier B (Claude Haiku). Results cached by call fingerprint. Falls back gracefully when no API key is set.

**MCP first.** Sentinel exposes its operational surface as a Python MCP server. VoiceOS picks it up via stdio and routes voice commands to our tools. Same protocol Sentinel defends.

**In memory event bus.** 50k ring buffer. Survives the demo, would persist to Postgres in production.

**No auth.** Anyone with dashboard access can decide. v2 work, called out in the pitch.

## Stack

| Layer    | Tech                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| Backend  | FastAPI, Pydantic, SSE, in memory event bus                                         |
| Ranker   | regex heuristics + Claude Haiku (`anthropic` Python SDK)                            |
| Eval     | Python, JSON labels, exposed at `/api/eval`                                         |
| Frontend | Next.js 16, Tailwind 4, React 19, TypeScript                                        |
| Chat     | `stream-chat` + `stream-chat-react` v14                                             |
| Video    | `trtc-sdk-v5` web SDK, HMAC SHA256 signed UserSigs                                  |
| Voice    | Python `mcp[cli]` stdio server registered with VoiceOS Custom Integrations          |
| Optional | `twilio` outbound calls (gracefully disabled without creds)                         |

## Running locally

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in keys you have
uvicorn app.main:app --reload --port 8000
```

Synthetic traffic starts automatically.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional sponsor creds (`backend/.env`)

```
ANTHROPIC_API_KEY=        # enables Tier B LLM ranker
STREAM_API_KEY=           # enables incident chat panel
STREAM_API_SECRET=
TRTC_SDK_APP_ID=          # enables war room
TRTC_SDK_SECRET_KEY=
TWILIO_ACCOUNT_SID=       # optional outbound calls
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_ONCALL_NUMBER=
```

Everything degrades gracefully. Missing keys hide the corresponding UI without breaking the app.

### Register Sentinel with VoiceOS

1. Ensure backend is running
2. In VoiceOS: *Settings → Integrations → Custom Integrations → Add*
3. Name: `Sentinel`
4. Launch command: `<absolute path>/backend/start.sh`

Then say: *"what's the latest critical?"* or *"release incident <id>"*.

## Project structure

```
backend/
  app/
    main.py                # FastAPI entrypoint
    interceptor.py         # tool call pipeline
    ranker.py              # composes heuristics + LLM
    heuristics.py          # Tier A rules
    llm_classifier.py      # Tier B Haiku
    policy.py              # score -> severity -> verdict
    event_bus.py           # in memory pub/sub + SSE
    schemas.py             # Pydantic models
    mcp_server.py          # MCP stdio server for VoiceOS
    escalation/
      stream.py            # Stream Chat client
      trtc.py              # TRTC UserSig + war room
      twilio_call.py       # optional outbound call
    eval/
      dataset.py           # labeled examples
      harness.py           # precision / recall / F1 report
    data/
      synthetic_traces.py  # mock traffic generator
  start.sh                 # MCP launch script for VoiceOS

frontend/
  src/
    app/page.tsx           # dashboard
    lib/api.ts             # backend client
    lib/useEventStream.ts  # SSE hook
    components/
      WarRoom.tsx          # TRTC modal + TTS + STT
      StreamPanel.tsx      # embedded chat
      IncidentMessage.tsx  # custom Stream message UI
```

## What's next

- Real JSON RPC MCP proxy in front of production agent fleets (currently schema compatible interceptor)
- Per customer fine tuned classifiers trained on their own agent traces
- Fleet wide firewall rule generation from observed attacks
- Role based decision authorization, audit logs, multi party approval for highest stakes blocks

Every company deploying agents in 2026 will need this layer.
