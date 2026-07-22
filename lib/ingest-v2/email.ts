// lib/ingest-v2/email.ts — v2 전용 .eml 파서. stdlib만 사용, 절대 throw 하지 않는다.
// v1 lib/source-text.ts 는 xlsx/pptx/docx 전용이라 이메일은 별도 경로로 원문 텍스트를 뽑는다.

export interface ParsedEmail {
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}

// RFC2047 encoded-word: =?charset?B?base64?= 또는 =?charset?Q?quoted-printable?=
function decodeEncodedWords(s: string): string {
  try {
    return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _charset, enc, text) => {
      try {
        if (enc.toLowerCase() === "b") {
          return Buffer.from(text, "base64").toString("utf8"); // ponytail: charset 무시, utf8 고정 — 비-utf8 인코딩 필요해지면 확장
        }
        // quoted-printable: _ → space, =XX → byte
        const qp = text.replace(/_/g, " ");
        return decodeQuotedPrintable(qp);
      } catch {
        return text;
      }
    });
  } catch {
    return s;
  }
}

function decodeQuotedPrintable(s: string): string {
  try {
    const withoutSoftBreaks = s.replace(/=\r?\n/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < withoutSoftBreaks.length; i++) {
      const c = withoutSoftBreaks[i];
      if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(withoutSoftBreaks.slice(i + 1, i + 3))) {
        bytes.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(c.charCodeAt(0));
      }
    }
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return s;
  }
}

function stripHtml(html: string): string {
  try {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();
  } catch {
    return html;
  }
}

// 헤더 블록 파싱: 폴딩(다음 줄이 공백으로 시작)된 헤더는 이어붙인다.
function parseHeaders(headerBlock: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const rawLines = headerBlock.split(/\r?\n/);
    const lines: string[] = [];
    for (const line of rawLines) {
      if (/^[ \t]/.test(line) && lines.length) {
        lines[lines.length - 1] += " " + line.trim();
      } else {
        lines.push(line);
      }
    }
    for (const line of lines) {
      const m = /^([^:]+):\s*(.*)$/.exec(line);
      if (m) map.set(m[1].trim().toLowerCase(), m[2].trim());
    }
  } catch {
    // best-effort — 부분 결과라도 반환
  }
  return map;
}

function getHeaderParam(headerValue: string, param: string): string | undefined {
  const re = new RegExp(param + '="?([^";]+)"?', "i");
  const m = re.exec(headerValue);
  return m?.[1];
}

// multipart 본문에서 boundary 로 파트를 나눠 text/plain 우선, 없으면 text/html(스트립) 선택.
function extractMultipartBody(body: string, boundary: string): string {
  const parts = body.split("--" + boundary).filter((p) => p.trim() && p.trim() !== "--");
  let htmlFallback: string | undefined;
  for (const part of parts) {
    const blankIdx = part.search(/\r?\n\r?\n/);
    if (blankIdx < 0) continue;
    const partHeaders = parseHeaders(part.slice(0, blankIdx));
    const partBody = part.slice(blankIdx).replace(/^\r?\n\r?\n/, "");
    const ct = partHeaders.get("content-type") ?? "";
    const cte = (partHeaders.get("content-transfer-encoding") ?? "").toLowerCase();
    const decoded = decodeBodyByEncoding(partBody, cte);
    if (ct.toLowerCase().includes("text/plain")) return decoded;
    if (ct.toLowerCase().includes("text/html") && htmlFallback === undefined) htmlFallback = stripHtml(decoded);
  }
  return htmlFallback ?? "";
}

function decodeBodyByEncoding(body: string, cte: string): string {
  try {
    if (cte === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    if (cte === "quoted-printable") return decodeQuotedPrintable(body);
    return body;
  } catch {
    return body;
  }
}

/** .eml 버퍼 → 헤더 + 본문. 절대 throw 하지 않는다 — 실패해도 얻은 만큼만 채워 반환. */
export function parseEml(buf: Buffer): ParsedEmail {
  const result: ParsedEmail = { from: "", to: "", subject: "", date: "", body: "" };
  try {
    const raw = buf.toString("utf8");
    const splitIdx = raw.search(/\r?\n\r?\n/);
    const headerBlock = splitIdx >= 0 ? raw.slice(0, splitIdx) : raw;
    let body = splitIdx >= 0 ? raw.slice(splitIdx).replace(/^\r?\n\r?\n/, "") : "";

    const headers = parseHeaders(headerBlock);
    result.from = decodeEncodedWords(headers.get("from") ?? "");
    result.to = decodeEncodedWords(headers.get("to") ?? "");
    result.subject = decodeEncodedWords(headers.get("subject") ?? "");
    result.date = headers.get("date") ?? "";

    const contentType = headers.get("content-type") ?? "";
    const cte = (headers.get("content-transfer-encoding") ?? "").toLowerCase();

    if (/multipart\//i.test(contentType)) {
      const boundary = getHeaderParam(contentType, "boundary");
      body = boundary ? extractMultipartBody(body, boundary) : body;
    } else {
      body = decodeBodyByEncoding(body, cte);
      if (/text\/html/i.test(contentType) || /<html/i.test(body)) body = stripHtml(body);
    }

    result.body = body;
  } catch {
    // best-effort — 부분 결과라도 반환(body 는 raw 그대로일 수 있음)
  }
  return result;
}

/** 파싱된 이메일 → LLM 입력용 단일 텍스트 블록. */
export function emailToText(parsed: ParsedEmail): string {
  return `제목: ${parsed.subject}\n보낸사람: ${parsed.from}\n받는사람: ${parsed.to}\n일자: ${parsed.date}\n\n${parsed.body}`;
}
