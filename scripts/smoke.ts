// scripts/smoke.ts — 배포/로컬 인스턴스 스모크 검증.
// 사용: npx tsx scripts/smoke.ts [baseUrl]   (기본 http://localhost:3003)
// 야간 자율 개발분 포함 전 API 를 한 번에 두드려 핵심 불변식을 확인한다. 실패 시 exit 1.
/* eslint-disable no-console */

const BASE = (process.argv[2] ?? "http://localhost:3003").replace(/\/$/, "");

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function getJson(path: string) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}
async function postJson(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

async function main() {
  console.log(`smoke → ${BASE}`);

  // 1) 온톨로지 로드 + BOM CONSISTS_OF
  const onto = await getJson("/api/ontology");
  check("ontology nodes", onto.nodes.length >= 170, `${onto.nodes.length}`);
  const co = onto.edges.filter((e: { rel: string }) => e.rel === "CONSISTS_OF").length;
  check("CONSISTS_OF (BOM 인제스천)", co >= 10, `${co}`);

  // 2) 기본 조건 추론 — 결로 데모 + 마스터 대조
  const fog = await postJson("/api/infer", {
    market: "아시아", lightSource: "LED", shape: ["슬림 하우징", "밀폐형"], components: ["아우터 렌즈"],
  });
  check("infer 기본 체크리스트", fog.checklist.length >= 5, `${fog.checklist.length}`);
  check("infer 결로 최상위권", fog.checklist.slice(0, 3).some((c: { title: string }) => /결로|습기/.test(c.title)));
  const mfog = (fog.masterAudit ?? []).find((m: { master: { id: string } }) => m.master.id === "MFOG");
  check("masterAudit MFOG 존재", !!mfog);
  check("masterAudit 누락 감지", !!mfog && mfog.missing.length >= 1, mfog ? mfog.missing.join(",") : "-");

  // 3) 부품 앵커 추론
  const anchored = await postJson("/api/infer", {
    market: "아시아", lightSource: "LED", shape: ["밀폐형"], anchorItem: "LED 모듈",
  });
  check(
    "anchorItem 스코프",
    anchored.checklist.length > 0 && anchored.checklist.every((c: { desc: string }) => c.desc.includes("선택 부품")),
    `${anchored.checklist.length}건`
  );

  // 4) BOM 정합성
  const bom = await getJson("/api/bom-check?item=IHL");
  check("bom-check findings", bom.findings.length >= 1, `${bom.findings.length}`);
  check(
    "bom-check 근거·trace (골든 룰)",
    bom.findings.every((f: { evidence: string[]; trace: string[] }) => f.evidence.length > 0 && f.trace.length > 0)
  );

  // 5) 전역 모순 스캔
  const contra = await getJson("/api/contradictions");
  check("contradictions items", contra.items.length >= 1, `${contra.items.length}`);
  check(
    "contradictions 근거 (골든 룰)",
    contra.items.every((i: { evidence: string[]; trace: string[] }) => i.evidence.length > 0 && i.trace.length > 0)
  );

  // 5.5) 품질 감사 + 확신도 breakdown
  const qual = await getJson("/api/quality");
  check("quality scan 응답", Array.isArray(qual.items), `${qual.items.length}건`);
  const withBd = fog.checklist.filter((c: { breakdown?: object }) => c.breakdown);
  check("confidence breakdown 존재", withBd.length === fog.checklist.length, `${withBd.length}/${fog.checklist.length}`);
  check(
    "breakdown 합계 == confidence",
    fog.checklist.every((c: { confidence: number; breakdown?: Record<string, number> }) => {
      if (!c.breakdown) return false;
      const s = c.breakdown.sim + c.breakdown.evid + c.breakdown.sev + c.breakdown.master + c.breakdown.boost;
      return Math.abs(s - c.confidence / 100) <= 0.011;
    })
  );

  // 5.7) 유도 관계 (pyservice /reason — 미가용이면 빈 배열 폴백이 정상)
  const reason = await getJson("/api/reason");
  check("reason 응답(200+배열)", Array.isArray(reason.items), `${reason.items.length}건`);
  if (reason.items.length > 0) {
    check(
      "reason via 근거 (골든 룰)",
      reason.items.every((i: { via: string[] }) => i.via.length > 0)
    );
  }

  // 6) 자연어 검색
  const nl = await postJson("/api/nlsearch", { query: "북미에서 결로 문제 대책이 있었나" });
  check("nlsearch hits", nl.hits.length >= 1, `${nl.hits.length}`);

  // 7) FMEA 초안 다운로드 (바이트 확인만)
  const fmeaRes = await fetch(`${BASE}/api/fmea-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ market: "아시아", lightSource: "LED", shape: ["밀폐형"] }),
  });
  const buf = await fmeaRes.arrayBuffer();
  check("fmea-draft xlsx", fmeaRes.ok && buf.byteLength > 5000, `${buf.byteLength}B`);

  // 8) 원천 목록
  const src = await getJson("/api/sources");
  const n = Array.isArray(src) ? src.length : (src.sources?.length ?? 0);
  check("sources 목록", n >= 35, `${n}`);

  console.log(failures === 0 ? "\nSMOKE OK" : `\nSMOKE FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
