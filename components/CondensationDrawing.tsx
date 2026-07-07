"use client";

// 헤드램프 결로 단면도 — 고정 구성(렌즈/하우징/LED/방열판/씰링/벤트)에 지역별 drawing 플래그
// (DrawingFlags)를 얹어 실제 엔지니어링 단면도처럼 렌더링한다.
// 원칙: boolean 플래그는 "무엇을 그릴지"(벤트 추가/드레인/히팅코일/이중개스킷/멤브레인/코팅 해칭)만
// 결정하고, "뭐라고 부를지"는 실제 callouts[] 문자열로만 표기한다 — 지역별 문구는 하드코딩하지 않는다.
import { useId, useMemo, type ReactNode } from "react";
import { riskColor, type DrawingFlags } from "./condensationTypes";

interface Pt {
  x: number;
  y: number;
}

// ── 고정 앵커 좌표(단면도 좌표계, viewBox 0 0 640 340) ──
const LENS_APEX: Pt = { x: 158, y: 180 };
const LENS_TOP_RIM: Pt = { x: 210, y: 66 };
const COND_MID: Pt = { x: 202, y: 180 };
const COATING_MID: Pt = { x: 233, y: 150 };
const HEATER_MID: Pt = { x: 205, y: 240 };
const GASKET_TOP: Pt = { x: 210, y: 66 };
const HOUSING_MID: Pt = { x: 468, y: 190 };
const LED_MID: Pt = { x: 295, y: 182 };
const HEATSINK_MID: Pt = { x: 408, y: 180 };
const VENT1: Pt = { x: 345, y: 68 };
const VENT2: Pt = { x: 405, y: 68 };
const DRAIN: Pt = { x: 345, y: 296 };

/** 지역 callout 문자열을 도면 상의 관련 지점으로 배치(키워드 기반, 표시 텍스트는 실데이터 그대로). */
function anchorForCallout(text: string): Pt {
  if (/벤트|통풍|브리더/.test(text)) return VENT1;
  if (/드레인|배수/.test(text)) return DRAIN;
  if (/코팅|발수/.test(text)) return COATING_MID;
  if (/히팅|열선|코일/.test(text)) return HEATER_MID;
  if (/개스킷|씰링|씰/.test(text)) return GASKET_TOP;
  if (/침수|ipx|IPX|시험/i.test(text)) return HOUSING_MID;
  return LENS_APEX;
}

function elbowPath(anchor: Pt, collectorX: number, labelY: number): string {
  return `M${anchor.x},${anchor.y} L${collectorX},${anchor.y} L${collectorX},${labelY}`;
}

interface LeaderProps {
  anchor: Pt;
  collectorX: number;
  labelY: number;
  align: "left" | "right";
  children: ReactNode;
  tone?: "amber" | "dim";
}

function Leader({ anchor, collectorX, labelY, align, children, tone = "dim" }: LeaderProps) {
  const textX = align === "right" ? collectorX + 8 : collectorX - 8;
  return (
    <g className={"cx-leader" + (tone === "amber" ? " amber" : "")}>
      <path d={elbowPath(anchor, collectorX, labelY)} />
      <circle cx={anchor.x} cy={anchor.y} r={2.4} />
      <text x={textX} y={labelY} textAnchor={align === "right" ? "start" : "end"} dominantBaseline="middle">
        {children}
      </text>
    </g>
  );
}

interface CondensationDrawingProps {
  drawing: DrawingFlags;
  lensLabel: string;
  housingLabel: string;
  riskLevel: string;
}

export default function CondensationDrawing({ drawing, lensLabel, housingLabel, riskLevel }: CondensationDrawingProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { extraVent, drain, lensHeater, doubleGasket, membraneBreather, dustMembrane, hydrophobicCoating, callouts } =
    drawing;

  const isMembraneVent = membraneBreather || dustMembrane;

  // 실제 callout 텍스트를 우측 하단에 순서대로 쌓는다(키워드로 가장 관련있는 지점에 리더 연결).
  const stackedCallouts = useMemo(
    () => callouts.map((text, i) => ({ text, anchor: anchorForCallout(text), y: 258 + i * 24 })),
    [callouts]
  );

  const outerSilhouette = "M207,66 C155,98 155,262 207,294 L456,284 Q477,278 477,257 L477,103 Q477,81 456,75 Z";
  const innerJoint = "M219,74 C180,100 180,260 219,286";
  const condOuter = "M231,88 C198,112 198,248 231,272";
  const coatingOuter = "M241,92 C209,114 209,246 241,268";
  const heaterZigzag = "M223,192 L200,202 L223,213 L200,224 L223,236 L200,247 L223,258 L206,270";

  return (
    <svg
      className="cx-drawing"
      viewBox="0 0 640 340"
      role="img"
      aria-label={`${lensLabel}-${housingLabel} 결로 단면도, 위험도 ${riskLevel}`}
    >
      <defs>
        <pattern id={`cond-${uid}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#5EA8FF" strokeWidth="1" opacity="0.55" />
        </pattern>
        <pattern id={`coat-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#00a2e5" strokeWidth="0.8" opacity="0.6" />
        </pattern>
        <pattern id={`gasket-${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#eef2f8" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#dbe3ee" strokeWidth="1" />
        </pattern>
        <pattern id={`membrane-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#ffffff" />
          <circle cx="1.5" cy="1.5" r="0.9" fill="#8291a8" />
        </pattern>
      </defs>

      {/* ── 외곽 실루엣: 렌즈 전면 곡선 + 하우징 후방 셸 ── */}
      <path d={outerSilhouette} className="cx-outline cx-item" />

      {/* 렌즈 재질 크레센트(외곽선~내측 접합선) */}
      <path d="M207,66 C155,98 155,262 207,294 L219,286 C180,260 180,100 219,74 Z" className="cx-lens-fill" />
      {/* 내측 접합선(렌즈 안쪽 면 / 개스킷 라인) */}
      <path d={innerJoint} className="cx-line" />

      {/* 결로 발생 영역(내측 면에 습기 응결) */}
      <path
        d="M219,74 C180,100 180,260 219,286 L231,272 C198,248 198,112 231,88 Z"
        fill={`url(#cond-${uid})`}
        className="cx-cond-fill"
      />
      <path d={condOuter} className="cx-line cx-dim" />

      {/* 발수 코팅(내면) — hydrophobicCoating일 때만 그래픽 표시 */}
      {hydrophobicCoating && (
        <>
          <path
            d="M231,88 C198,112 198,248 231,272 L241,268 C209,246 209,114 241,92 Z"
            fill={`url(#coat-${uid})`}
            className="cx-coating-fill"
          />
          <path d={coatingOuter} className="cx-line cx-amber-line" strokeDasharray="3 2" />
        </>
      )}

      {/* 히팅 코일 — lensHeater일 때만 */}
      {lensHeater && <path d={heaterZigzag} className="cx-heater" />}

      {/* 씰링/개스킷 — 상단·하단 접합부(항상 표시). doubleGasket이면 두 겹 */}
      <g className="cx-gasket">
        <rect x="200" y="62" width="18" height="6" fill={`url(#gasket-${uid})`} rx="1" />
        <rect x="200" y="288" width="18" height="6" fill={`url(#gasket-${uid})`} rx="1" />
        {doubleGasket && (
          <>
            <rect x="200" y="70" width="18" height="6" fill={`url(#gasket-${uid})`} rx="1" />
            <rect x="200" y="280" width="18" height="6" fill={`url(#gasket-${uid})`} rx="1" />
          </>
        )}
      </g>

      {/* LED 모듈 + 방열판(항상 표시) */}
      <g className="cx-led">
        <rect x="268" y="158" width="52" height="44" rx="3" className="cx-outline cx-fm" />
        <rect x="278" y="168" width="32" height="10" rx="1" className="cx-led-chip" />
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={332 + i * 17} y1={162} x2={332 + i * 17} y2={198} className="cx-heatsink-fin" />
        ))}
      </g>

      {/* 방수 벤트 1(항상 표시) + 벤트 2(extraVent) */}
      <g className="cx-vent">
        <rect
          x="330"
          y="60"
          width="26"
          height="14"
          rx="2"
          fill={isMembraneVent ? `url(#membrane-${uid})` : "#f4f7fb"}
          className="cx-outline"
        />
        {!isMembraneVent && <path d="M335,72 L335,84 M335,84 L331,79 M335,84 L339,79" className="cx-air-arrow" />}
      </g>
      {extraVent && (
        <g className="cx-vent">
          <rect
            x="392"
            y="60"
            width="26"
            height="14"
            rx="2"
            fill={isMembraneVent ? `url(#membrane-${uid})` : "#f4f7fb"}
            className="cx-outline"
          />
          {!isMembraneVent && <path d="M397,72 L397,84 M397,84 L393,79 M397,84 L401,79" className="cx-air-arrow" />}
        </g>
      )}

      {/* 하부 드레인 — drain일 때만 */}
      {drain && (
        <g className="cx-drain">
          <path d="M332,290 L332,312 L358,312 L358,290" className="cx-outline" fill="none" />
          <path d="M345,296 L345,318 M345,318 L340,311 M345,318 L350,311" className="cx-air-arrow" />
        </g>
      )}

      {/* ── 고정 구성 라벨 (좌: 렌즈/결로/씰링, 우: 하우징/LED/방열판/벤트) ── */}
      <Leader anchor={LENS_APEX} collectorX={64} labelY={100} align="left">
        {lensLabel} · PC
      </Leader>
      <Leader anchor={COND_MID} collectorX={64} labelY={150} align="left" tone="amber">
        결로 발생 영역
      </Leader>
      <Leader anchor={LENS_TOP_RIM} collectorX={64} labelY={200} align="left">
        씰링{doubleGasket ? "(이중)" : ""}
      </Leader>

      <Leader anchor={HOUSING_MID} collectorX={576} labelY={100} align="right">
        {housingLabel} · PP-GF
      </Leader>
      <Leader anchor={LED_MID} collectorX={576} labelY={150} align="right">
        LED 모듈
      </Leader>
      <Leader anchor={HEATSINK_MID} collectorX={576} labelY={190} align="right">
        방열판
      </Leader>
      <Leader anchor={VENT1} collectorX={576} labelY={230} align="right">
        방수 벤트{extraVent ? "(2개소)" : ""}
      </Leader>

      {/* ── 지역 근거 callouts (실데이터, 우측 하단 스택) ── */}
      {stackedCallouts.map((c, i) => (
        <Leader key={i} anchor={c.anchor} collectorX={576} labelY={c.y} align="right" tone="amber">
          {c.text}
        </Leader>
      ))}

      {/* 위험도 배지 */}
      <text x="16" y="24" className="cx-risk" fill={riskColor(riskLevel)}>
        위험도 {riskLevel}
      </text>
    </svg>
  );
}
