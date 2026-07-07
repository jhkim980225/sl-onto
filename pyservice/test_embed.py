import math

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_embed():
    assert client.get("/health").json()["status"] == "ok"

    texts = ["헤드램프 결로 불량", "condensation on lamp", "원인 분석"]
    vectors = client.post("/embed", json={"texts": texts}).json()["vectors"]
    assert len(vectors) == len(texts)
    for v in vectors:
        assert len(v) == 384
        assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, abs_tol=1e-3)

    assert client.post("/embed", json={"texts": []}).json()["vectors"] == []
