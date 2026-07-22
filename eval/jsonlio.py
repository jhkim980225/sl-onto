# eval/jsonlio.py — 골든셋 jsonl 읽기/쓰기. 순수.
import json


def write(path: str, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def read(path: str) -> list[dict]:
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def _selftest():
    import tempfile, os
    rows = [{"question": "배합한도?", "ground_truth": "1.0%", "reference_contexts": ["a", "b"]}]
    p = os.path.join(tempfile.gettempdir(), "gold_test.jsonl")
    write(p, rows)
    back = read(p)
    assert back == rows, back
    print("jsonlio selftest OK")


if __name__ == "__main__":
    _selftest()
