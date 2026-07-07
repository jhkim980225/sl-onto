// lib/drawing-risk.ts — 도면 설계 취약점 규칙 검사 (5단계 BOM 정합성의 1차 구현).
// 도면이 실제로 담은 데이터(소재·형상 특징·텍스트 좌표·목표 시장)만으로 판정 — 설명 가능·결정론적.
import type { DrawingData, DxfEntity } from "./ingest/dxf";
import { parseVent } from "./shape-sim";

export interface DrawingRisk {
  level: "높음" | "주의";
  title: string;
  detail: string;
}

// 소재 열팽창 계수(CTE, µm/m·K) — 대표값(도메인 상수). BOM 정합성 검사(lib/bom-consistency.ts)도 재사용.
export const CTE: Record<string, number> = {
  PC: 65, "PC+ABS": 75, PMMA: 70, PA6: 80, "FR-4": 16,
  EPDM: 160, 실리콘: 250, 고무: 150,
};
export const cteOf = (s?: string) => {
  if (!s) return undefined;
  const up = s.toUpperCase();
  // 정확 일치 우선, 부분 매칭은 긴 키부터 — "PC+ABS"가 "PC"(65)로 잘못 잡히는 것 방지(리뷰 지적).
  const keys = Object.keys(CTE).sort((a, b) => b.length - a.length);
  const key = keys.find((k) => up === k.toUpperCase()) ?? keys.find((k) => up.includes(k.toUpperCase()));
  return key ? CTE[key] : undefined;
};

export function assessDrawing(d: DrawingData, ents: DxfEntity[], market?: string): DrawingRisk[] {
  const out: DrawingRisk[] = [];

  // 1) 하우징 소재 ↔ 개스킷 소재 열팽창 차이 → 온도 변화 시 실링부 미세 틈
  const housingMat = cteOf(d.labels["소재"]);
  const gasketMat = cteOf(d.features["개스킷 소재"]);
  if (housingMat !== undefined && gasketMat !== undefined) {
    const diff = Math.abs(housingMat - gasketMat);
    if (diff >= 80) {
      out.push({
        level: "주의",
        title: "하우징-개스킷 열팽창 차이",
        detail: `CTE 차이 ≈${diff}µm/m·K (하우징 ${housingMat} ↔ 개스킷 ${gasketMat}) — 온도 사이클 시 실링부 미세 틈 가능, 압축률 여유 확인 요`,
      });
    }
  }

  // 2) 벤트 홀 ↔ 발열원(LED) 근접 — 텍스트 좌표 기반(도면 주석 위치)
  const texts = d.texts;
  const led = texts.find((t) => /^LED/i.test(t.value));
  const vents = texts.filter((t) => /VENT/i.test(t.value));
  if (led && vents.length) {
    const near = vents
      .map((v) => ({ v, dist: Math.hypot(v.x - led.x, v.y - led.y) }))
      .filter((x) => x.dist < 45);
    if (near.length) {
      out.push({
        level: "주의",
        title: "벤트 홀-발열원 근접",
        detail: `${near.map((x) => x.v.value).join("·")} 이(가) LED 발열원과 근접(도면 좌표 기준) — 온도차 유입 공기 응결(내부 결로) 유발 가능`,
      });
    }
  }

  // 3) 커넥터/개스킷 IP 등급 vs 목표 시장 습도 조건
  const ip = d.features["커넥터"];
  const digits = ip?.match(/\d+/)?.[0];
  const humidMarket = market && /아시아|동남아|중동|중국/.test(market);
  if (digits && humidMarket) {
    const grade = parseInt(digits, 10);
    if (grade < 66) {
      out.push({
        level: "높음",
        title: "IP 등급-시장 습도 부적합",
        detail: `커넥터 ${ip} — 목표 시장(${market}) 고온다습 조건 대비 낮은 등급. 유사 등급 설계의 결로·부식 이력 대조 필수`,
      });
    } else {
      out.push({
        level: "주의",
        title: "IP 등급 스펙 통과 — 이력 대조 요",
        detail: `커넥터 ${ip}는 등급상 충족하나, 고온다습(${market})에서는 등급 통과 ≠ 환경 감당 — 유사 형상 설계의 결로 클레임 이력 확인 권장`,
      });
    }
  }

  // 4) 벤트 개수 vs 밀폐 하우징 — 밀폐형인데 벤트 1개 이하면 습기 배출 경로 부족
  const vent = parseVent(d.features["벤트 홀"]);
  if (/밀폐/.test(d.features["하우징"] ?? "") && (vent.count ?? 0) <= 1) {
    out.push({
      level: "높음",
      title: "밀폐 하우징 벤트 부족",
      detail: `밀폐형 하우징에 벤트 ${vent.count ?? 0}개소 — 내부 습공기 배출 경로 부족, 결로 위험(아시아권 표준: 상·하 2개소 + 드레인)`,
    });
  }

  return out;
}
