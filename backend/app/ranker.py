"""Layered ranker: Tier-A heuristics → Tier-B LLM for the ambiguous band.

Most traffic resolves at Tier A (decisive high or low score). The LLM only
fires when the heuristic is uncertain, keeping the hot path fast and cheap.
"""
from . import heuristics, llm_classifier
from .schemas import ThreatAssessment, ToolCall


async def rank(call: ToolCall) -> ThreatAssessment:
    h = heuristics.evaluate(call)

    if not h.ambiguous:
        return ThreatAssessment(
            score=h.score,
            category=h.category,
            rationale=h.rationale,
            matched_rules=h.matched_rules,
        )

    llm = await llm_classifier.classify(call)
    if llm is None:
        # LLM unavailable — fall back to heuristic, mark category as uncertain
        return ThreatAssessment(
            score=h.score,
            category=h.category or "uncertain",
            rationale=h.rationale + " [heuristic-only; LLM unavailable]",
            matched_rules=h.matched_rules,
        )

    # Blend: LLM score wins, heuristic rules retained as evidence
    final_score = max(h.score, llm.score) if h.matched_rules else llm.score
    return ThreatAssessment(
        score=final_score,
        category=llm.category,
        rationale=f"{llm.rationale} (LLM, base={h.score:.2f})",
        matched_rules=h.matched_rules + ["llm_review"],
    )
