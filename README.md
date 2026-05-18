# Sentinel

**Runtime firewall for AI agents. Operations layer for the AI Factory.**

> 🏆 **Winner — Best Use of VoiceOS & Hypescribe** at Hack-A-Stack 2026 (Santa Clara University, Endurance Track).
> 📄 [Devpost submission](https://devpost.com/software/sentinel-uheo94)

Sentinel watches two failure modes with the same reasoning engine: AI agents on top of infrastructure, and the GPU infrastructure underneath them. Both fail in new ways, and both need the same response shape — rank the threat, recommend the action, cite the evidence, escalate when stakes warrant.

---

## Demo

▶️ **[Watch the demo video](assets/sentinel-demo.mp4)** &nbsp;·&nbsp; 📄 **[Read the Devpost write-up](https://devpost.com/software/sentinel-uheo94)**

---

## The problem

AI factories run two things on top of GPUs: AI agents, and the infrastructure underneath them. Both fail in new ways, and the tools that exist today are split. Detection libraries flag threats but never act (Lakera, NeMo, Llama Guard). Observability platforms log incidents after the damage is done (LangSmith, Helicone). Cluster monitoring catches GPU memory and network problems but does not understand LLM semantics. Engineers stitch three or four panes of glass together, often at 3 AM, while an agent quietly drops a production table or a model serving config crashes a customer endpoint.

Sentinel exists because the response to an agent attempting to delete a database should not look fundamentally different from the response to a GPU node overheating. Both are operational incidents. Both need the same answer: what happened, why, what action to take, who to wake up.

---

## Two layers, one engine

### Layer 1 — Agent firewall

Every tool call an AI agent makes is intercepted, scored by a two-tier ranker (regex heuristics first, Claude Haiku for the ambiguous middle band), and routed by severity. Critical events auto-block. High severity opens a war room. Medium events post to a Stream chat channel with action buttons. Our labeled eval set of 36 examples reports **100% precision, 95% recall, F1 0.97** — live in the dashboard footer.

### Layer 2 — AI Factory operations

Sentinel ingests Cisco's AI Factory dataset (18 scenarios across performance, GPU placement, and failure detection), reads alerts, logs, and runbooks, and returns Cisco's required structured recommendation: action, target, reason category, confidence, evidence. Each recommendation also includes a plain-English reasoning sentence and a three-step on-call playbook with specific thresholds. All 18 scenarios pass Cisco's official `validate_recommendation.py --require-all` validator.

### Cross-layer escalation

Both layers share the same downstream surfaces. A Stream incident feed with filter tabs (All / Agent / Cisco / Escalations) is the audit log. The same MCP server exposes voice triage for both layers. The same Google Meet war room spawns for critical events on either layer.

---

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
          log only      Stream chat      VoiceOS MCP        Google Meet
          (low)         (medium)         (high)             war room (critical)
```

Cisco scenarios flow through the same severity router. A high-severity infrastructure recommendation triggers the same Stream channel and war room a critical agent attack would.

---

## Severity routing

| Tier | Surface | Sponsor |
|---|---|---|
| Low | Dashboard log only | — |
| Medium | Auto-created incident channel with approve/deny buttons | **Stream** |
| High | Voice triage via MCP — ask Sentinel, tell it what to do | **VoiceOS** |
| Critical | Auto-spawned video war room any responder can join | **Google Meet** (Tencent TRTC UserSig minting also implemented) |

Plus **Anthropic Claude Haiku** powering the LLM tier of the ranker, and **Cisco's AI Factory dataset** as the Layer 2 ground truth.

---

## Demo flow

**Layer 1 — agent attack**
1. Dashboard streams intercepted events in real time
2. Click *Fire demo attack*. An agent attempts `DROP TABLE users`
3. Ranker scores it 0.97, policy auto-blocks, severity routes to Critical
4. Red banner appears with action buttons
5. Verdict propagates back to the dashboard and the Stream channel in real time

**Layer 2 — Cisco scenario**
1. Open the Cisco panel, pick scenario `perf-001`
2. Click *Evaluate with Sentinel*
3. Recommendation card returns: action, target, reason, confidence, evidence
4. Green *Next steps* card shows a three-step on-call playbook with thresholds
5. Click the ✓ *Cisco validator passed* pill to see the validator output
6. Click *Page on-call* — Cisco recommendation hits the Stream channel
7. Click *Open war room* — Google Meet spins up, link goes to Stream

**Voice**
- From VoiceOS, say *"what's the latest critical?"* — Sentinel reads the agent incident aloud
- Say *"evaluate scenario fail-005"* — Sentinel reads the Cisco recommendation aloud
- Same MCP server, both layers, hands-free

---

## Eval

A 36-example labeled set runs on server boot. Live metrics show in the dashboard footer.

| Metric | Heuristics only | + LLM (Haiku) |
|---|---|---|
| Precision | 100% | **100%** |
| Recall | 84% | **95%** |
| F1 | 0.91 | **0.97** |

Cisco validator (Layer 2): all 18 scenarios pass `validate_recommendation.py --require-all`.

Run agent eval:
```bash
cd backend
source .venv/bin/activate
python -m app.eval.harness
```

Run Cisco validator:
```bash
cd backend/cisco_data/ai_factory_hackathon_student
python validate_recommendation.py ../../sentinel_recommendations.json --require-all
```

---

## Architecture decisions

**Two-tier ranker.** Most traffic resolves at Tier A (regex heuristics) in microseconds. Only the ambiguous band (score roughly 0.20–0.70) escalates to Tier B (Claude Haiku). Results cached by call fingerprint. Falls back gracefully when no API key is set.

**Same engine, two signal streams.** The Cisco advisor is a separate module but shares the LLM client, the structured-output pattern, the severity router, and the downstream channels (Stream, VoiceOS, war room). A Cisco recommendation looks like an agent incident from the response surface's point of view.

**MCP-first.** Sentinel exposes its operational surface as a Python MCP server with 8 tools (`incidents_lookup`, `incidents_decide`, `sentinel_status`, `cisco_scenarios`, `cisco_evaluate`, `warroom_create_meet`, `current_meet_link`, `warroom_invite`). VoiceOS picks it up via stdio and routes voice commands to our tools. Same protocol Sentinel defends.

**In-memory event bus.** 50k ring buffer with SSE streaming to the dashboard. Survives the demo. Would persist to Postgres in production.

**Graceful degradation.** Missing API keys hide the corresponding UI without breaking the app. The demo runs end-to-end with no credentials at all.

**No auth.** Anyone with dashboard access can decide. v2 work, called out in the pitch.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI, Pydantic, SSE, in-memory event bus |
| Ranker (Tier A) | regex heuristics, allow/denylists |
| Ranker (Tier B) | Claude Haiku via anthropic Python SDK |
| Cisco advisor | Heuristic routing by primary alert + LLM enrichment for reasoning + next steps |
| Eval | Python, JSON labels, exposed at `/api/eval` |
| Frontend | Next.js 16, Tailwind 4, React 19, TypeScript |
| Chat | stream-chat (server) + stream-chat-react v14 |
| Video | Google Meet (pre-provisioned room link); Tencent TRTC HMAC-SHA256 UserSig minting also implemented |
| Voice | Python `mcp[cli]` stdio server registered with VoiceOS Custom Integrations |
| Optional | twilio outbound calls (gracefully disabled without creds) |

---

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
Open http://localhost:3000.

### Optional sponsor creds (`backend/.env`)
```
ANTHROPIC_API_KEY=        # enables Tier B LLM ranker + Cisco reasoning
STREAM_API_KEY=           # enables incident chat panel
STREAM_API_SECRET=
TRTC_SDK_APP_ID=          # enables TRTC UserSig minting
TRTC_SDK_SECRET_KEY=
GOOGLE_MEET_LINK=         # war room Meet room
TWILIO_ACCOUNT_SID=       # optional outbound calls
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_ONCALL_NUMBER=
```
Everything degrades gracefully. Missing keys hide the corresponding UI without breaking the app.

---

## Register Sentinel with VoiceOS

1. Ensure backend is running
2. In VoiceOS: *Settings → Integrations → Custom Integrations → Add*
3. Name: `Sentinel`
4. Launch command: `<absolute path>/backend/start.sh`

Then say:
- *"what's the latest critical?"*
- *"evaluate scenario perf-001"*
- *"release incident 42"*
- *"send the war room link to chu2@scu.edu"*

---

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
    event_bus.py           # in-memory pub/sub + SSE
    schemas.py             # Pydantic models
    mcp_server.py          # MCP stdio server for VoiceOS (8 tools)
    cisco/
      advisor.py           # Layer 2 Cisco scenario evaluator
      data.py              # scenario loader (CSV -> dict)
    escalation/
      stream.py            # Stream Chat client
      trtc.py              # TRTC UserSig minting
      google_meet.py       # Google Meet war room
      twilio_call.py       # optional outbound call
    eval/
      dataset.py           # labeled examples
      harness.py           # precision / recall / F1 report
    data/
      synthetic_traces.py  # mock traffic generator
  cisco_data/              # Cisco-provided dataset + validator
    ai_factory_hackathon_student/
      validate_recommendation.py
      data/public/evaluation_scenarios.csv
  start.sh                 # MCP launch script for VoiceOS

frontend/
  src/
    app/page.tsx           # dashboard
    lib/api.ts             # backend client
    lib/useEventStream.ts  # SSE hook
    components/
      WarRoom.tsx          # Google Meet war room modal + TTS
      StreamPanel.tsx      # embedded chat with filter tabs
      StreamFilterContext.tsx  # filter state for All/Agent/Cisco/Escalations
      IncidentMessage.tsx  # custom Stream message UI
      CiscoPanel.tsx       # Layer 2 scenario evaluator (+ inline ValidatorModal)
```

---

## What's next

- **Real JSON-RPC MCP proxy** in front of production agent fleets (current interceptor is schema-compatible)
- **Per-customer fine-tuned classifiers** trained on customer-specific agent traces
- **Fleet-wide firewall rule generation** from observed attacks across the agent fleet
- **Closed-loop remediation on Layer 2** — Sentinel executes its own recommendations after human approval, with rollback and audit
- **Role-based authorization and multi-party approval** for highest-stakes blocks
- **Deeper Cisco integration** — beyond evaluation, integrate with live Cisco infrastructure telemetry

Every company deploying AI agents in 2026 will need this layer.

---

## Team

Built at Hack-A-Stack 2026, Santa Clara University. Awarded **Best Use of VoiceOS & Hypescribe** by the sponsor judges.

- [Ankush Rai](https://github.com/akrai37)
- [Harshvardhan Garude](https://github.com/Harshvardhan-Garude)
- [Ray Hu](https://github.com/chu2)

## Links

- 📄 [Devpost](https://devpost.com/software/sentinel-uheo94)
- 🎥 [Demo video](assets/sentinel-demo.mp4)
