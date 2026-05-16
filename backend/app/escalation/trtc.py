"""TRTC user-sig generation + war-room provisioning.

User-sig algorithm (Tencent reference):
1. Build a JSON object with sdkappid, identifier, expire-after, current-time, sig
2. The "sig" is HMAC-SHA256(secret_key, content_to_sign) where content_to_sign
   concatenates the other fields in a canonical order
3. zlib-compress the JSON, base64-encode (URL-safe alphabet)

This mirrors `genSig.py` from Tencent's official SDK examples.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import zlib


def _env_app_id() -> int:
    val = os.environ.get("TRTC_SDK_APP_ID", "0")
    try:
        return int(val)
    except ValueError:
        return 0


def _env_secret() -> str:
    return os.environ.get("TRTC_SDK_SECRET_KEY", "")


def available() -> bool:
    return _env_app_id() > 0 and _env_secret() != ""


def _hmacsha256(sdkappid: int, secret_key: str, identifier: str,
                curr_time: int, expire: int) -> str:
    content = (
        f"TLS.identifier:{identifier}\n"
        f"TLS.sdkappid:{sdkappid}\n"
        f"TLS.time:{curr_time}\n"
        f"TLS.expire:{expire}\n"
    )
    h = hmac.new(secret_key.encode("utf-8"), content.encode("utf-8"), hashlib.sha256)
    return base64.b64encode(h.digest()).decode("utf-8")


def gen_user_sig(identifier: str, expire_seconds: int = 86400) -> str:
    """Generate a TRTC UserSig for the given user identifier."""
    sdkappid = _env_app_id()
    secret = _env_secret()
    if not (sdkappid and secret):
        raise RuntimeError("TRTC creds missing; set TRTC_SDK_APP_ID + TRTC_SDK_SECRET_KEY")

    curr_time = int(time.time())
    sig = _hmacsha256(sdkappid, secret, identifier, curr_time, expire_seconds)

    obj = {
        "TLS.ver": "2.0",
        "TLS.identifier": identifier,
        "TLS.sdkappid": sdkappid,
        "TLS.expire": expire_seconds,
        "TLS.time": curr_time,
        "TLS.sig": sig,
    }
    compressed = zlib.compress(json.dumps(obj).encode("utf-8"))
    # TRTC uses a custom alphabet: replace + / = with * - _
    return (
        base64.b64encode(compressed)
        .decode("utf-8")
        .replace("+", "*")
        .replace("/", "-")
        .replace("=", "_")
    )


def warroom_for_incident(incident_id: str, joiner: str = "oncall") -> dict:
    """Return the bundle a browser needs to join a TRTC room for this incident."""
    sdkappid = _env_app_id()
    if not sdkappid:
        return {"error": "trtc_unavailable", "reason": "missing TRTC creds"}
    # TRTC string-room limit is 64 chars; prefix to avoid numeric collision
    room_id = f"sentinel-{incident_id}"[:64]
    user_id = f"{joiner}-{int(time.time())}"
    return {
        "sdk_app_id": sdkappid,
        "room_id": room_id,
        "user_id": user_id,
        "user_sig": gen_user_sig(user_id),
    }
