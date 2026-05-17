"""Google Meet war-room escalation.

Hackathon-grade: uses a single pre-created Meet link configured via the
GOOGLE_MEET_LINK env var. Every "war room" returns that link, optionally
posts to the Stream channel so engineers can click to join, and tracks
who has been invited so we can list them later.

No Google Calendar API integration — that path requires OAuth /
domain-wide delegation that we don't have time to set up.
"""
from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("sentinel.google_meet")


def link() -> str:
    return os.environ.get("GOOGLE_MEET_LINK", "")


def available() -> bool:
    return bool(link())


def status() -> dict[str, Any]:
    return {
        "available": available(),
        "meet_link": link() or None,
        "mode": "pre-created-link",
    }


# In-memory: incident_id -> {"meet_link": str, "invited": list[str]}
_rooms: dict[str, dict[str, Any]] = {}


def get_for_incident(incident_id: str) -> dict[str, Any] | None:
    return _rooms.get(incident_id)


def create_warroom(
    incident_id: str | None = None,
    title: str | None = None,
    description: str | None = None,
    attendees: list[str] | None = None,
) -> dict[str, Any]:
    """Return the configured Google Meet link for this incident. Reuses
    the same link/state if called twice for the same incident_id."""
    if not available():
        return {
            "provider": "google_meet",
            "created": False,
            "available": False,
            "message": "GOOGLE_MEET_LINK is not configured.",
        }

    key = incident_id or "latest"
    existing = _rooms.get(key)
    if existing is not None:
        if attendees:
            seen = set(existing["invited"])
            for a in attendees:
                if a and a not in seen:
                    existing["invited"].append(a)
                    seen.add(a)
        return {
            "provider": "google_meet",
            "incident_id": key,
            "meet_link": existing["meet_link"],
            "attendees": existing["invited"],
            "title": existing.get("title"),
            "description": existing.get("description"),
            "created": False,
            "reused": True,
            "message": f"War room already open. Reusing link {existing['meet_link']}.",
        }

    room = {
        "meet_link": link(),
        "invited": list(dict.fromkeys(attendees or [])),
        "title": title or f"Sentinel War Room — {key}",
        "description": description or "",
    }
    _rooms[key] = room
    return {
        "provider": "google_meet",
        "incident_id": key,
        "meet_link": room["meet_link"],
        "attendees": room["invited"],
        "title": room["title"],
        "description": room["description"],
        "created": True,
        "reused": False,
        "message": f"Google Meet war room ready: {room['meet_link']}",
    }


def add_attendees(incident_id: str, people: list[str]) -> dict[str, Any]:
    if not available():
        return {"ok": False, "message": "GOOGLE_MEET_LINK is not configured."}
    room = _rooms.get(incident_id)
    if room is None:
        # Auto-create on first invite
        create_warroom(incident_id=incident_id, attendees=people)
        room = _rooms[incident_id]
        return {
            "ok": True,
            "incident_id": incident_id,
            "meet_link": room["meet_link"],
            "invited": room["invited"],
            "new": list(people),
            "message": f"Created war room and invited {len(people)} responder(s).",
        }
    seen = set(room["invited"])
    new_people = [p for p in people if p and p not in seen]
    for p in new_people:
        room["invited"].append(p)
    return {
        "ok": True,
        "incident_id": incident_id,
        "meet_link": room["meet_link"],
        "invited": room["invited"],
        "new": new_people,
        "message": f"Added {len(new_people)} responder(s) to the war room.",
    }
