"""Tests for POST /llm — vLLM mocked via monkeypatch, no network (contract: always HTTP 200)."""
import httpx
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def mock_chat(monkeypatch, content: str):
    captured = {}

    async def fake(messages, max_tokens=400):
        captured["messages"] = messages
        captured["max_tokens"] = max_tokens
        return content

    monkeypatch.setattr(main, "_chat", fake)
    return captured


NLSEARCH_REQ = {"task": "nlsearch", "query": "북미 결로", "catalog": "[item] I1=램프 | I2=하우징"}
REVIEW_REQ = {
    "task": "review",
    "condition": "북미 헤드램프 결로",
    "checklist": [{"no": 1, "title": "벤트 위치", "desc": "하단 벤트 확인", "confidence": 80}],
    "masterAudit": ["마스터 3.2항 누락"],
    "contradictions": ["CHECK 1 vs 마스터 상충"],
}


def test_nlsearch_parses_and_strips_think(monkeypatch):
    cap = mock_chat(monkeypatch,
        '<think>내부 추론...</think>{"answer":"관련 2건","interpretation":"북미·결로","ids":["I1","I2"]}')
    body = client.post("/llm", json=NLSEARCH_REQ).json()
    assert body == {"ok": True, "result": {
        "answer": "관련 2건", "interpretation": "북미·결로", "ids": ["I1", "I2"]}}
    # 프롬프트 계약: 시스템 프롬프트 이식 + /no_think + 카탈로그 포함
    assert cap["messages"][0]["content"] == main.NLSEARCH_SYSTEM
    assert cap["messages"][1]["content"].startswith("/no_think")
    assert "I1=램프" in cap["messages"][1]["content"]


def test_review_parses_and_normalizes_cited_checks(monkeypatch):
    cap = mock_chat(monkeypatch,
        '{"opinion":"[CHECK 1] 벤트 위치 재검토 필요.","citedChecks":["1", 2, "x"]}')
    body = client.post("/llm", json=REVIEW_REQ).json()
    assert body["ok"] is True
    assert body["result"]["opinion"].startswith("[CHECK 1]")
    assert body["result"]["citedChecks"] == [1, 2]  # 문자열→int, 비변환 항목 제거
    user = cap["messages"][1]["content"]
    assert "CHECK 1: 벤트 위치" in user and "마스터 3.2항 누락" in user and "상충" in user


def test_review_empty_opinion_is_error(monkeypatch):
    mock_chat(monkeypatch, '{"opinion":"","citedChecks":[1]}')
    body = client.post("/llm", json=REVIEW_REQ).json()
    assert body["ok"] is False and body["error"]


ASK_REQ = {
    "task": "ask",
    "question": "이 부품의 주요 고장 원인은?",
    "context": "객체: 아우터 렌즈 (유형: 부품·구성)\n관계:\nR1: [고장/HAS_FAILURE] 아우터 렌즈 → 황변 (상대 유형: 고장모드)",
}


def test_ask_parses_and_normalizes_cited_rels(monkeypatch):
    cap = mock_chat(monkeypatch,
        '<think>추론</think>{"answer":"황변이 주요 고장이다 [R 1].","citedRels":["1", 2, "x"]}')
    body = client.post("/llm", json=ASK_REQ).json()
    assert body["ok"] is True
    assert "[R 1]" in body["result"]["answer"]
    assert body["result"]["citedRels"] == [1, 2]
    assert cap["messages"][0]["content"] == main.ASK_SYSTEM
    user = cap["messages"][1]["content"]
    assert user.startswith("/no_think") and "R1:" in user and "주요 고장 원인" in user


def test_ask_empty_answer_is_error(monkeypatch):
    mock_chat(monkeypatch, '{"answer":"","citedRels":[1]}')
    body = client.post("/llm", json=ASK_REQ).json()
    assert body["ok"] is False and body["error"]


EXTRACT_REQ = {
    "task": "extract",
    "text": "벤트 어셈블리에서 결로·습기 발생. 원인: 습기 유입 경로 미확인.",
    "vocab": "fm:FMFOG=결로·습기 | item:IHL=헤드램프 어셈블리",
}


def test_extract_parses_and_normalizes(monkeypatch):
    cap = mock_chat(monkeypatch,
        '<think>추론</think>{"entities":[{"type":"fm","id":"FMFOG","label":"결로·습기"},'
        '{"type":"cause","label":"습기 유입 경로 미확인"},{"type":"item","label":""},"문자열"],'
        '"relations":[{"srcLabel":"결로·습기","rel":"CAUSED_BY","dstLabel":"습기 유입 경로 미확인"},'
        '{"srcLabel":"","rel":"HAS_FAILURE","dstLabel":"x"},[1]]}')
    body = client.post("/llm", json=EXTRACT_REQ).json()
    assert body["ok"] is True
    # 빈 label 개체·비 dict 항목·빈 srcLabel 관계는 관대하게 폐기
    assert body["result"]["entities"] == [
        {"type": "fm", "label": "결로·습기", "id": "FMFOG"},
        {"type": "cause", "label": "습기 유입 경로 미확인"},
    ]
    assert body["result"]["relations"] == [
        {"srcLabel": "결로·습기", "rel": "CAUSED_BY", "dstLabel": "습기 유입 경로 미확인"}]
    # 프롬프트 계약: extract 시스템 프롬프트 + vocab·문서 포함 + 토큰 상한 800
    assert cap["messages"][0]["content"] == main.EXTRACT_SYSTEM
    user = cap["messages"][1]["content"]
    assert user.startswith("/no_think") and "fm:FMFOG=결로·습기" in user and "벤트 어셈블리" in user
    assert cap["max_tokens"] == 800


def test_extract_truncates_text_and_tolerates_missing_fields(monkeypatch):
    cap = mock_chat(monkeypatch, '{"entities":"아님"}')  # entities 가 list 아님, relations 없음
    long_req = dict(EXTRACT_REQ, text="가" * 5000)
    body = client.post("/llm", json=long_req).json()
    assert body == {"ok": True, "result": {"entities": [], "relations": []}}
    # 4000자 절단 — 프롬프트에 5000자가 통째로 들어가지 않는다
    assert "가" * 4000 in cap["messages"][1]["content"]
    assert "가" * 4001 not in cap["messages"][1]["content"]


def test_vllm_down_returns_ok_false(monkeypatch):
    async def boom(messages, max_tokens=400):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(main, "_chat", boom)
    res = client.post("/llm", json=NLSEARCH_REQ)
    assert res.status_code == 200  # 500 금지
    body = res.json()
    assert body["ok"] is False and "ConnectError" in body["error"]


def test_non_json_output_returns_ok_false(monkeypatch):
    mock_chat(monkeypatch, "<think>only thoughts</think>JSON 아님")
    body = client.post("/llm", json=NLSEARCH_REQ).json()
    assert body["ok"] is False and body["error"]


def test_unknown_task_returns_ok_false():
    body = client.post("/llm", json={"task": "poem"}).json()
    assert body["ok"] is False and "poem" in body["error"]


def test_extract_json_handles_prose_wrapping():
    assert main.extract_json('앞말 {"a": 1} 뒷말') == {"a": 1}
    assert main.extract_json("<think>{...}</think>no json here") is None
    assert main.extract_json('[1,2]') is None  # dict만 허용


def test_norm_extract_passes_summary_and_doc_type():
    from main import _norm_extract
    out = _norm_extract({
        "summary": " 성진 견적 요청 ",
        "doc_type": "견적",
        "entities": [{"type": "인물", "label": "정아라"}],
        "relations": [{"srcLabel": "정아라", "rel": "소속", "dstLabel": "성진"}],
    })
    assert out["summary"] == "성진 견적 요청"
    assert out["doc_type"] == "견적"
    assert out["entities"] == [{"type": "인물", "label": "정아라"}]


def test_norm_extract_defaults_missing_summary_doc_type_to_empty():
    from main import _norm_extract
    out = _norm_extract({"entities": [], "relations": []})
    assert out["summary"] == ""
    assert out["doc_type"] == ""
