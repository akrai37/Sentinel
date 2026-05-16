#!/usr/bin/env bash
# Sentinel MCP server launcher for VoiceOS Custom Integrations.
#
# Register in VoiceOS:
#   Settings → Integrations → Custom Integrations → Add
#   Name:           🛡 Sentinel
#   Launch command: /absolute/path/to/Sentinel/backend/start.sh
#
# Requires the Sentinel FastAPI backend running on :8000 (uvicorn app.main:app).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ -f ".venv/bin/python" ]; then
    exec .venv/bin/python -m app.mcp_server
else
    exec python3 -m app.mcp_server
fi
