"""Tests for POST /parse — synthetic PDF built by hand (no reportlab), pypdf round-trip.

make_pdf: Type0/Identity-H font + identity ToUnicode CMap so pypdf extracts
Unicode (Korean) text without any embedded font program. Reused by the e2e
ingest check script (scripts/check-pdf-ingest side).
"""
import base64
import io

from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def make_pdf(lines: list[str]) -> bytes:
    """Minimal valid PDF: one page, each line its own text object (y step → newline on extract)."""
    def hexstr(s: str) -> str:
        return "<" + s.encode("utf-16-be").hex().upper() + ">"

    content = "\n".join(
        f"BT /F1 12 Tf 50 {800 - 20 * i} Td {hexstr(line)} Tj ET" for i, line in enumerate(lines)
    ).encode()
    # identity bfranges split to avoid the surrogate block (pypdf rejects ranges crossing D800).
    tounicode = (
        b"/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n"
        b"/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n"
        b"1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
        b"2 beginbfrange\n<0000> <D7FF> <0000>\n<E000> <FFFF> <E000>\nendbfrange\n"
        b"endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend"
    )
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type0 /BaseFont /Synth /Encoding /Identity-H "
        b"/DescendantFonts [5 0 R] /ToUnicode 7 0 R >>",
        b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Synth "
        b"/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
        b"/FontDescriptor << /Type /FontDescriptor /FontName /Synth /Flags 4 "
        b"/FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 "
        b"/CapHeight 700 /StemV 80 >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(tounicode), tounicode),
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i)
        out.write(o)
        out.write(b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for off in offsets:
        out.write(b"%010d 00000 n \n" % off)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref))
    return out.getvalue()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


KOREAN_LINES = ["품질 이슈 보고서", "부품: 하우징", "고장모드: 결로", "원인: 벤트 막힘", "조치: 벤트 재설계"]


def test_parse_roundtrip_korean():
    pdf = make_pdf(KOREAN_LINES)
    body = client.post("/parse", json={"filename": "품질리포트.pdf", "content_base64": b64(pdf)}).json()
    assert body["ok"] is True
    assert body["engine"] in ("pypdf", "docling")
    assert body["pages"] == 1
    for line in KOREAN_LINES:
        assert line in body["text"]


def test_parse_keeps_line_breaks():
    # lib/ingest linkFreeText 의 "키: 값" 정규식은 [^\n:]+ 로 값을 끊는다 — 줄 분리가 계약.
    pdf = make_pdf(["부품: 하우징", "원인: 벤트 막힘"])
    text = client.post("/parse", json={"filename": "t.pdf", "content_base64": b64(pdf)}).json()["text"]
    lines = [l.strip() for l in text.splitlines()]
    assert any(l.startswith("부품") for l in lines)
    assert any(l.startswith("원인") for l in lines)
    assert not any("부품" in l and "원인" in l for l in lines)


def test_parse_invalid_base64():
    body = client.post("/parse", json={"filename": "t.pdf", "content_base64": "!!!not-base64"}).json()
    assert body["ok"] is False and body["error"]


def test_parse_empty_content():
    body = client.post("/parse", json={"filename": "t.pdf", "content_base64": ""}).json()
    assert body["ok"] is False and body["error"]


def test_parse_garbage_bytes_never_500():
    res = client.post("/parse", json={"filename": "t.pdf", "content_base64": b64(b"this is not a pdf")})
    assert res.status_code == 200  # 500 금지
    body = res.json()
    assert body["ok"] is False and body["error"]
