from .schemas import InterceptedEvent, Severity, ThreatAssessment, ToolCall, Verdict


def severity_for(score: float) -> Severity:
    if score >= 0.9:
        return Severity.CRITICAL
    if score >= 0.6:
        return Severity.HIGH
    if score >= 0.3:
        return Severity.MEDIUM
    return Severity.LOW


def decide(call: ToolCall, assessment: ThreatAssessment) -> InterceptedEvent:
    sev = severity_for(assessment.score)
    if sev is Severity.CRITICAL:
        verdict = Verdict.BLOCK
        channel = "voiceos"
    elif sev is Severity.HIGH:
        verdict = Verdict.PENDING_HUMAN
        channel = "voiceos"
    elif sev is Severity.MEDIUM:
        verdict = Verdict.PENDING_HUMAN
        channel = "stream"
    else:
        verdict = Verdict.ALLOW
        channel = "none"

    return InterceptedEvent(
        call=call,
        assessment=assessment,
        severity=sev,
        verdict=verdict,
        escalation_channel=channel,
        human_decision="pending" if verdict is Verdict.PENDING_HUMAN else None,
    )
