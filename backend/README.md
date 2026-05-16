# Sentinel Backend

FastAPI service that intercepts agent tool calls, ranks threats, and streams events to the dashboard.

## Run locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in keys as integrations come online
uvicorn app.main:app --reload --port 8000
```

Synthetic traffic starts automatically on boot. Hit `http://localhost:8000/api/events/stream` to watch the SSE feed, or `POST /api/demo/attack` to fire the critical-tier demo event.

## VoiceOS MCP Integration

Sentinel ships an MCP server (stdio) that VoiceOS can launch to give engineers voice-driven triage.

Tools exposed:
- `incidents_lookup(incident_id?, min_severity?, limit?)` — list recent or fetch one
- `incidents_decide(incident_id, action)` — block / release / escalate
- `sentinel_status()` — quick health + latest critical

**Register in VoiceOS:**
1. Make sure `uvicorn app.main:app --port 8000` is running.
2. In VoiceOS: *Settings → Integrations → Custom Integrations → Add*
3. Name: `🛡 Sentinel`  
   Launch command: `<absolute path>/Sentinel/backend/start.sh`

Then say things like:
- *"What's the latest critical?"*
- *"Block incident bb47a92487d5"*
- *"Is Sentinel ok?"*

