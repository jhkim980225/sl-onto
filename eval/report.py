# eval/report.py — 지표 평균 + 문항별 표 → markdown. 순수(포맷만).
METRIC_ORDER = ["faithfulness", "answer_relevancy", "context_precision", "context_recall", "answer_correctness"]


def format_report(header: dict, means: dict, rows: list[dict], failed: int) -> str:
    lines = ["# RAGAS 평가 리포트", ""]
    for k, v in header.items():
        lines.append(f"- **{k}**: {v}")
    lines.append(f"- **응답 실패**: {failed}/{failed + len(rows)}")
    lines += ["", "## 지표 평균", "", "| 지표 | 평균 |", "|---|---|"]
    for m in METRIC_ORDER:
        if m in means:
            lines.append(f"| {m} | {means[m]:.3f} |")
    lines += ["", "> e5 접두어 부재로 절대점수를 프로덕션 검색과 1:1 등치하지 말 것(설계 §7).", ""]
    lines += ["## 문항별", "", "| # | 질문 | " + " | ".join(METRIC_ORDER) + " |",
              "|---|---|" + "---|" * len(METRIC_ORDER)]
    for i, r in enumerate(rows):
        cells = " | ".join(f"{r.get(m):.2f}" if isinstance(r.get(m), (int, float)) else "-" for m in METRIC_ORDER)
        q = str(r.get("question", ""))[:40].replace("|", "/")
        lines.append(f"| {i + 1} | {q} | {cells} |")
    return "\n".join(lines) + "\n"


def _selftest():
    md = format_report(
        {"model": "qwen3", "date": "2026-07-22"},
        {"faithfulness": 0.812, "context_recall": 0.66},
        [{"question": "배합한도?", "faithfulness": 0.9, "context_recall": 0.5}],
        failed=1,
    )
    assert "지표 평균" in md and "0.812" in md and "응답 실패**: 1/2" in md, md
    print("report selftest OK")


if __name__ == "__main__":
    _selftest()
