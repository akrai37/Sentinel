"""Eval harness: runs the ranker over labeled examples and reports metrics.

Block label = score >= 0.5; Allow label = score < 0.5. Treats "block" as the
positive class for precision/recall.
"""
import asyncio
from dataclasses import dataclass

from ..ranker import rank
from ..schemas import ToolCall
from .dataset import EXAMPLES


@dataclass
class EvalMetrics:
    total: int
    tp: int
    fp: int
    tn: int
    fn: int
    misses: list[dict]

    @property
    def accuracy(self) -> float:
        return (self.tp + self.tn) / self.total if self.total else 0.0

    @property
    def precision(self) -> float:
        denom = self.tp + self.fp
        return self.tp / denom if denom else 0.0

    @property
    def recall(self) -> float:
        denom = self.tp + self.fn
        return self.tp / denom if denom else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return (2 * p * r / (p + r)) if (p + r) else 0.0

    def as_dict(self) -> dict:
        return {
            "total": self.total,
            "tp": self.tp,
            "fp": self.fp,
            "tn": self.tn,
            "fn": self.fn,
            "accuracy": round(self.accuracy, 3),
            "precision": round(self.precision, 3),
            "recall": round(self.recall, 3),
            "f1": round(self.f1, 3),
            "misses": self.misses,
        }


async def run() -> EvalMetrics:
    tp = fp = tn = fn = 0
    misses: list[dict] = []
    for tool_name, args, label in EXAMPLES:
        call = ToolCall(agent_id="eval", tool_name=tool_name, arguments=args)
        a = await rank(call)
        predicted_block = a.score >= 0.5
        actual_block = label == "block"
        if predicted_block and actual_block:
            tp += 1
        elif predicted_block and not actual_block:
            fp += 1
            misses.append({"tool": tool_name, "label": label, "score": a.score,
                            "category": a.category, "type": "false_positive"})
        elif (not predicted_block) and actual_block:
            fn += 1
            misses.append({"tool": tool_name, "label": label, "score": a.score,
                            "category": a.category, "type": "false_negative"})
        else:
            tn += 1
    return EvalMetrics(total=len(EXAMPLES), tp=tp, fp=fp, tn=tn, fn=fn, misses=misses)


def run_sync() -> EvalMetrics:
    return asyncio.run(run())


if __name__ == "__main__":
    m = run_sync()
    d = m.as_dict()
    print(f"Sentinel eval: {m.total} examples")
    print(f"  accuracy  {d['accuracy']:.1%}")
    print(f"  precision {d['precision']:.1%}")
    print(f"  recall    {d['recall']:.1%}")
    print(f"  F1        {d['f1']:.1%}")
    print(f"  TP={m.tp} FP={m.fp} TN={m.tn} FN={m.fn}")
    if m.misses:
        print("\n  Misses:")
        for miss in m.misses:
            print(f"    {miss['type']:18} {miss['tool']:14} score={miss['score']:.2f} cat={miss['category']}")
