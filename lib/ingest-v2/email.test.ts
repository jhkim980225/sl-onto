// lib/ingest-v2/email.test.ts — .eml 파서 회귀(라이브 의존성 불필요).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { parseEml, emailToText } = await import("./email.ts");

test("일반 이메일: 헤더 + 본문 파싱, emailToText 에 제목/본문 포함", () => {
  const eml = [
    "From: 홍길동 <hong@example.com>",
    "To: kim@example.com",
    "Subject: 회의 일정 안내",
    "Date: Wed, 22 Jul 2026 09:00:00 +0900",
    "",
    "내일 오전 10시 회의입니다.",
  ].join("\r\n");
  const parsed = parseEml(Buffer.from(eml, "utf8"));
  assert.equal(parsed.from, "홍길동 <hong@example.com>");
  assert.equal(parsed.to, "kim@example.com");
  assert.equal(parsed.subject, "회의 일정 안내");
  assert.equal(parsed.date, "Wed, 22 Jul 2026 09:00:00 +0900");
  assert.ok(parsed.body.includes("내일 오전 10시 회의입니다."));
  const text = emailToText(parsed);
  assert.ok(text.includes("회의 일정 안내"));
  assert.ok(text.includes("내일 오전 10시 회의입니다."));
});

test("quoted-printable 본문 디코딩: 소프트 줄바꿈 + =XX 이스케이프", () => {
  const eml = [
    "From: a@example.com",
    "To: b@example.com",
    "Subject: qp test",
    "Date: Wed, 22 Jul 2026 09:00:00 +0900",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Hello=20World",
    "abc=",
    "def",
  ].join("\r\n");
  const parsed = parseEml(Buffer.from(eml, "utf8"));
  assert.ok(parsed.body.includes("Hello World"));
  assert.ok(parsed.body.includes("abcdef"));
});

test("base64 본문 디코딩", () => {
  const bodyText = "Base64 로 인코딩된 본문입니다.";
  const b64 = Buffer.from(bodyText, "utf8").toString("base64");
  const eml = [
    "From: a@example.com",
    "To: b@example.com",
    "Subject: b64 test",
    "Date: Wed, 22 Jul 2026 09:00:00 +0900",
    "Content-Transfer-Encoding: base64",
    "",
    b64,
  ].join("\r\n");
  const parsed = parseEml(Buffer.from(eml, "utf8"));
  assert.ok(parsed.body.includes(bodyText));
});

test("HTML 본문: 태그 제거", () => {
  const eml = [
    "From: a@example.com",
    "To: b@example.com",
    "Subject: html test",
    "Date: Wed, 22 Jul 2026 09:00:00 +0900",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body><p>안녕하세요 &amp; 반갑습니다</p></body></html>",
  ].join("\r\n");
  const parsed = parseEml(Buffer.from(eml, "utf8"));
  assert.ok(!parsed.body.includes("<p>"));
  assert.ok(parsed.body.includes("안녕하세요 & 반갑습니다"));
});

test("폴딩된 헤더: 다음 줄이 공백으로 시작하면 이어붙인다", () => {
  const eml = [
    "From: a@example.com",
    "To: b@example.com",
    "Subject: 매우 긴 제목이라서",
    " 두 줄에 걸쳐 있음",
    "Date: Wed, 22 Jul 2026 09:00:00 +0900",
    "",
    "본문",
  ].join("\r\n");
  const parsed = parseEml(Buffer.from(eml, "utf8"));
  assert.equal(parsed.subject, "매우 긴 제목이라서 두 줄에 걸쳐 있음");
});

test("견고성: 쓰레기 버퍼도 throw 하지 않고 객체를 반환한다", () => {
  const garbage = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x80, 0x81]);
  const parsed = parseEml(garbage);
  assert.equal(typeof parsed, "object");
  assert.equal(typeof parsed.body, "string");
  assert.doesNotThrow(() => emailToText(parsed));
});
