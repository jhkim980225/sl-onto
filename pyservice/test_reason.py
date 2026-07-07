"""Tests for POST /reason — no embedding model load (TestClient, /reason only)."""
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def post(nodes, edges):
    res = client.post("/reason", json={"nodes": nodes, "edges": edges})
    assert res.status_code == 200
    return res.json()["derived"]


NODES = [
    {"id": "lamp", "type": "item", "label": "램프"},
    {"id": "housing", "type": "item", "label": "하우징"},
    {"id": "vent", "type": "item", "label": "벤트"},
    {"id": "fm1", "type": "failure", "label": "결로"},
]


def test_consists_transitive():
    derived = post(NODES, [
        {"src": "lamp", "rel": "CONSISTS_OF", "dst": "housing"},
        {"src": "housing", "rel": "CONSISTS_OF", "dst": "vent"},
    ])
    hit = [d for d in derived if d["rule"] == "consists-transitive"]
    assert len(hit) == 1
    d = hit[0]
    assert (d["src"], d["rel"], d["dst"]) == ("lamp", "CONSISTS_OF", "vent")
    assert d["confidence"] == 0.85
    assert d["via"] == [
        "lamp→CONSISTS_OF→housing",
        "housing→CONSISTS_OF→vent",
    ]


def test_similar_symmetric_uses_weight():
    derived = post(NODES, [
        {"src": "lamp", "rel": "SIMILAR", "dst": "housing", "weight": 0.9},
    ])
    assert len(derived) == 1
    d = derived[0]
    assert (d["src"], d["rel"], d["dst"]) == ("housing", "SIMILAR", "lamp")
    assert d["rule"] == "similar-symmetric"
    assert d["confidence"] == 0.9
    assert d["via"] == ["lamp→SIMILAR→housing"]


def test_failure_propagation():
    derived = post(NODES, [
        {"src": "lamp", "rel": "CONSISTS_OF", "dst": "housing"},
        {"src": "housing", "rel": "HAS_FAILURE", "dst": "fm1"},
    ])
    hit = [d for d in derived if d["rule"] == "failure-propagation"]
    assert len(hit) == 1
    d = hit[0]
    assert (d["src"], d["rel"], d["dst"]) == ("lamp", "POTENTIAL_FAILURE", "fm1")
    assert d["confidence"] == 0.7
    assert d["via"] == [
        "lamp→CONSISTS_OF→housing",
        "housing→HAS_FAILURE→fm1",
    ]


def test_original_edges_excluded():
    # inverse SIMILAR already present -> nothing derived
    derived = post(NODES, [
        {"src": "lamp", "rel": "SIMILAR", "dst": "housing"},
        {"src": "housing", "rel": "SIMILAR", "dst": "lamp"},
    ])
    assert derived == []
    # transitive edge already asserted -> not re-derived
    derived = post(NODES, [
        {"src": "lamp", "rel": "CONSISTS_OF", "dst": "housing"},
        {"src": "housing", "rel": "CONSISTS_OF", "dst": "vent"},
        {"src": "lamp", "rel": "CONSISTS_OF", "dst": "vent"},
    ])
    assert [d for d in derived if d["rule"] == "consists-transitive"] == []


def test_via_never_empty():
    derived = post(NODES, [
        {"src": "lamp", "rel": "CONSISTS_OF", "dst": "housing"},
        {"src": "housing", "rel": "CONSISTS_OF", "dst": "vent"},
        {"src": "housing", "rel": "HAS_FAILURE", "dst": "fm1"},
        {"src": "vent", "rel": "SIMILAR", "dst": "housing"},
    ])
    assert derived
    assert all(d["via"] for d in derived)


def test_empty_and_bad_input_no_500():
    assert post([], []) == []
    # dangling edge references are skipped, not fatal
    assert post(NODES, [{"src": "ghost", "rel": "CONSISTS_OF", "dst": "lamp"}]) == []
