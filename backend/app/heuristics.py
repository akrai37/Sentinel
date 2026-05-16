"""Tier-A ranker: regex + allow/denylist heuristics.

Returns a heuristic assessment plus an "ambiguity" flag. When the heuristic
is decisive (very high or very low score) the interceptor short-circuits.
Otherwise the layered ranker promotes the call to Tier B (LLM).
"""
import re
from dataclasses import dataclass

from .schemas import ToolCall


@dataclass
class HeuristicResult:
    score: float
    category: str
    rationale: str
    matched_rules: list[str]
    ambiguous: bool  # True → escalate to LLM


# ---------- patterns ----------

DESTRUCTIVE_SQL = re.compile(
    r"\b(drop|truncate)\s+(table|database|schema)\b|\bdelete\s+from\b(?!.+\bwhere\b)",
    re.I,
)
DELETE_BROAD = re.compile(r"\bdelete\s+from\b.+\b1\s*=\s*1\b", re.I)
DESTRUCTIVE_SHELL = re.compile(
    r"\brm\s+-rf\s+/|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{\s*:|>\s*/dev/sd[a-z]|/dev/zero\s+of=/dev/",
    re.I,
)
SUSPICIOUS_SHELL = re.compile(
    r"\bsudo\b|\bchmod\s+777|\bnc\s+-l|/etc/passwd|/etc/shadow",
    re.I,
)
EXFIL_URL = re.compile(
    r"https?://(?!(?:[\w.-]+\.)?(github\.com|api\.github\.com|googleapis\.com|"
    r"google\.com|amazonaws\.com|openai\.com|anthropic\.com|stripe\.com|"
    r"slack\.com|notion\.so|stream-io-api\.com|trtc\.io|tencentcloudapi\.com))"
    r"[\w.-]+",
    re.I,
)
SECRET_HINT = re.compile(
    r"\b(api[_-]?key|secret|token|password|aws_secret|bearer)\b\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{8,}",
    re.I,
)
PII_HINT = re.compile(
    r"\b\d{3}-\d{2}-\d{4}\b|\b\d{16}\b",  # SSN, CC
)

BENIGN_READ = {"read_file", "list_dir", "search", "stat", "head", "tail"}
BENIGN_READ_TOOLS = re.compile(r"^(read|list|get|search|stat|head|tail|find)_", re.I)

# Outbound/mutating tools that *might* be benign but warrant LLM review
WRITE_SEND_TOOLS = {
    "send_email", "send_message", "send_webhook", "post_to_slack",
    "write_file", "http_post", "fetch", "upload", "publish",
}


# ---------- core ----------

def evaluate(call: ToolCall) -> HeuristicResult:
    blob = f"{call.tool_name} {call.arguments}"
    matched: list[str] = []
    score = 0.10
    category = "benign"
    rationale = "No matching threat patterns; passive read-shaped call."

    if DESTRUCTIVE_SQL.search(blob) or DELETE_BROAD.search(blob):
        matched.append("destructive_sql")
        score = max(score, 0.97)
        category = "destructive-sql"
        rationale = "Destructive SQL detected (DROP/TRUNCATE or unbounded DELETE)."

    if DESTRUCTIVE_SHELL.search(blob):
        matched.append("destructive_shell")
        score = max(score, 0.96)
        category = "destructive-shell"
        rationale = "Destructive shell command on root paths/devices."

    if SECRET_HINT.search(blob):
        matched.append("secret_in_payload")
        score = max(score, 0.85)
        category = "secret-exposure"
        rationale = "Likely credential/secret embedded in arguments."

    if EXFIL_URL.search(blob) and call.tool_name.lower() in {
        "http_post", "fetch", "curl", "send_webhook", "upload",
    }:
        matched.append("exfil_to_unknown_host")
        score = max(score, 0.78)
        if category == "benign":
            category = "possible-exfil"
            rationale = "Outbound POST/upload to an uncommon host."

    if SUSPICIOUS_SHELL.search(blob):
        matched.append("suspicious_shell")
        score = max(score, 0.55)
        if category == "benign":
            category = "suspicious-shell"
            rationale = "Shell command touches sensitive system surface."

    if PII_HINT.search(blob):
        matched.append("pii_in_payload")
        score = max(score, 0.50)
        if category == "benign":
            category = "possible-pii"
            rationale = "Payload looks like SSN or credit card."

    # Strong benign signal: read-shaped calls with no other matches
    if not matched and (call.tool_name in BENIGN_READ or BENIGN_READ_TOOLS.match(call.tool_name)):
        score = 0.03
        rationale = "Read-shaped tool with no risk indicators."

    # Write/send tools with nothing else flagged → ambiguous, defer to LLM
    if not matched and call.tool_name in WRITE_SEND_TOOLS:
        score = 0.40
        category = "uncertain-write"
        rationale = "Outbound or mutating tool — LLM review for intent."

    # Ambiguous band: heuristic was inconclusive
    ambiguous = (0.20 <= score <= 0.70) and len(matched) <= 1

    return HeuristicResult(
        score=score,
        category=category,
        rationale=rationale,
        matched_rules=matched,
        ambiguous=ambiguous,
    )
