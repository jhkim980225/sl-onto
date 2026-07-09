"""Tests for POST /export — no embedding model load (TestClient, /export only)."""
from fastapi.testclient import TestClient
from rdflib import Graph, Literal, URIRef
from rdflib.namespace import RDF, RDFS, XSD

from main import app

client = TestClient(app)

SLO = "http://sl-ontoground.local/onto#"


def post(payload):
    res = client.post("/export", json=payload)
    assert res.status_code == 200
    return res.json()


def reparse(body):
    g = Graph()
    g.parse(data=body["ttl"], format="turtle")
    assert len(g) == body["triples"]
    return g


def test_roundtrip_minimal():
    body = post({
        "objectTypes": [{"type_id": "item", "label_ko": "부품", "description": "램프 구성 부품"}],
        "relationTypes": [{
            "rel_id": "CONSISTS_OF", "label_ko": "구성",
            "src_types": ["item"], "dst_types": ["item"], "directed": True,
        }],
        "subtypes": [{"type_id": "item", "st_id": "optic", "label_ko": "광학"}],
        "propertyDefs": [{"type_id": "item", "key": "수량", "label_ko": "수량", "datatype": "number"}],
        "nodes": [
            {"id": "lamp", "type": "item", "st": "optic", "label": "램프", "props": [["수량", "2"]]},
            {"id": "lens", "type": "item", "st": "ghost", "label": "렌즈"},  # unknown st -> base class
        ],
        "edges": [{"src": "lamp", "rel": "CONSISTS_OF", "dst": "lens"}],
    })
    assert body["triples"] > 0
    g = reparse(body)
    lamp = URIRef(SLO + "n_lamp")
    # subtype class used when (type, st) is defined; unknown st falls back
    assert (lamp, RDF.type, URIRef(SLO + "item_optic")) in g
    assert (URIRef(SLO + "n_lens"), RDF.type, URIRef(SLO + "item")) in g
    # schema triples
    assert (URIRef(SLO + "item_optic"), RDFS.subClassOf, URIRef(SLO + "item")) in g
    assert (URIRef(SLO + "CONSISTS_OF"), RDFS.domain, URIRef(SLO + "item")) in g
    # numeric prop -> xsd:decimal literal (lexical form may normalize on round-trip)
    vals = list(g.objects(lamp, URIRef(SLO + "prop_%EC%88%98%EB%9F%89")))
    assert len(vals) == 1
    assert vals[0].datatype == XSD.decimal and float(vals[0]) == 2
    # edge triple
    assert (lamp, URIRef(SLO + "CONSISTS_OF"), URIRef(SLO + "n_lens")) in g
    # korean label as lang=ko literal
    assert (lamp, RDFS.label, Literal("램프", lang="ko")) in g


def test_special_char_ids_serialize_safely():
    nid = "AUTO_결로 (M-화이트)"
    body = post({
        "objectTypes": [{"type_id": "fm", "label_ko": "고장모드"}],
        "nodes": [{"id": nid, "type": "fm", "label": "결로 (M-화이트)",
                   "props": [["원인 (추정)", "습기 침투"]]}],
        "edges": [{"src": nid, "rel": "SIMILAR", "dst": nid}],
    })
    g = reparse(body)
    assert "결로 (M-화이트)" in body["ttl"]  # label survives as literal
    labels = [str(o) for _, _, o in g.triples((None, RDFS.label, None))]
    assert "결로 (M-화이트)" in labels


def test_empty_input_ok():
    body = post({})
    assert body["triples"] == 0
    Graph().parse(data=body["ttl"], format="turtle")  # still valid turtle
