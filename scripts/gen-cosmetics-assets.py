# scripts/gen-cosmetics-assets.py — 화장품 문서 세트의 이미지 자산(png 4건) 생성.
# 실행: python scripts/gen-cosmetics-assets.py
# 출력: docs/화장품/이미지/  (한글 렌더 = C:/Windows/Fonts/malgun.ttf)
# 주의: png 는 인제스천 대상이 아니다(ALLOWED_EXT 밖) — 사람이 보는 참고 자료.
# 결정적: 난수/현재시각 미사용.
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "화장품", "이미지")
os.makedirs(OUT, exist_ok=True)
FONT = "C:/Windows/Fonts/malgun.ttf"
NAVY, ACC, SUB, LINE, BG = (26, 43, 73), (0, 162, 229), (91, 107, 129), (216, 222, 233), (243, 247, 251)


def f(sz, bold=False):
    return ImageFont.truetype("C:/Windows/Fonts/malgunbd.ttf" if bold else FONT, sz)


def canvas(w, h, title, sub):
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 6], fill=ACC)
    d.text((32, 28), title, font=f(26, True), fill=NAVY)
    d.text((32, 66), sub, font=f(14), fill=SUB)
    d.line([32, 94, w - 32, 94], fill=LINE, width=1)
    d.text((32, h - 30), "코스메디아㈜ · 가상 문서 · 온톨로지 워크벤치 시연용", font=f(12), fill=SUB)
    return im, d


def label_mockup():
    im, d = canvas(900, 1200, "제품 라벨 목업", "CP-101 하이드라 수분크림 50ml · 후면 전성분 라벨 (Rev.C)")
    d.rounded_rectangle([70, 130, 830, 1120], 18, outline=NAVY, width=2, fill=BG)
    d.text((100, 160), "하이드라 수분크림", font=f(34, True), fill=NAVY)
    d.text((100, 208), "HYDRA MOISTURE CREAM  50ml", font=f(16), fill=SUB)
    d.line([100, 246, 800, 246], fill=LINE, width=1)
    rows = [
        ("제품명", "하이드라 수분크림"),
        ("제품 코드", "CP-101"),
        ("내용량", "50ml"),
        ("제조판매업자", "코스메디아㈜ (충북 청주시 산업로 12)"),
        ("제조업자", "코스메디아㈜ 청주공장"),
        ("사용기한", "제조일로부터 30개월 (용기 하단 별도 표기)"),
        ("로트번호", "CP101-2501A"),
        ("가격", "38,000원"),
    ]
    y = 268
    for k, v in rows:
        d.text((100, y), k, font=f(15, True), fill=NAVY)
        d.text((260, y), v, font=f(15), fill=SUB)
        y += 34
    d.text((100, y + 14), "전성분", font=f(17, True), fill=NAVY)
    inci = (
        "정제수, 글리세린, 스쿠알란, 부틸렌글라이콜, 카프릴릭/카프릭트라이글리세라이드, "
        "시어버터, 글리세릴스테아레이트, 나이아신아마이드, 세테아릴알코올, 다이메티콘, "
        "1,2-헥산다이올, 폴리소르베이트60, 판테놀, 세라마이드NP, 페녹시에탄올, 카보머, "
        "알란토인, 소듐하이알루로네이트, 잔탄검, 에틸헥실글리세린, 토코페롤, 향료, "
        "다이소듐이디티에이, 시트릭애씨드"
    )
    yy = y + 46
    line = ""
    for w in inci.split(" "):
        if len(line) + len(w) > 46:
            d.text((100, yy), line, font=f(14), fill=SUB)
            yy += 24
            line = w
        else:
            line = (line + " " + w).strip()
    d.text((100, yy), line, font=f(14), fill=SUB)
    yy += 44
    d.text((100, yy), "사용 시 주의사항", font=f(17, True), fill=NAVY)
    for t in [
        "1. 상처가 있는 부위에는 사용을 자제할 것",
        "2. 사용 중 붉은 반점·부어오름 등 이상 증상 시 사용 중지",
        "3. 직사광선을 피해 보관하고 어린이 손이 닿지 않는 곳에 둘 것",
        "4. 개봉 후에는 되도록 빠르게 사용할 것",
    ]:
        yy += 26
        d.text((100, yy), t, font=f(14), fill=SUB)
    d.rectangle([640, 940, 800, 1100], outline=NAVY, width=2)
    for i in range(0, 8):
        d.rectangle([652 + i * 18, 952, 660 + i * 18, 1088], fill=NAVY if i % 2 == 0 else "white")
    d.text((644, 1104), "QR / 바코드 영역", font=f(11), fill=SUB)
    im.save(os.path.join(OUT, "제품라벨목업_CP101.png"))


def pkg_spec():
    im, d = canvas(1400, 900, "포장 사양 도해", "CP-305 UV 선크림 SPF50+ 50ml · 펌프 용기 구성도")
    parts = [
        ("오버캡", "PP", 120), ("펌프 헤드", "PP+POM", 180), ("펌프 스프링", "STS304", 236),
        ("펌프 가스켓", "실리콘", 292), ("숄더 링", "ABS 증착", 348),
        ("용기 본체 50ml", "PP", 470), ("딥튜브", "LDPE", 600),
    ]
    cx = 300
    d.rectangle([cx - 70, 110, cx + 70, 150], outline=NAVY, width=2, fill=BG)      # 오버캡
    d.rectangle([cx - 45, 155, cx + 45, 200], outline=NAVY, width=2)               # 펌프 헤드
    d.rectangle([cx - 25, 205, cx + 25, 250], outline=NAVY, width=2)               # 스프링부
    d.line([cx - 20, 260, cx + 20, 260], fill=NAVY, width=3)                       # 가스켓
    d.rectangle([cx - 60, 268, cx + 60, 300], outline=NAVY, width=2)               # 숄더 링
    d.rounded_rectangle([cx - 90, 305, cx + 90, 700], 14, outline=NAVY, width=3, fill=BG)
    d.line([cx, 320, cx, 690], fill=SUB, width=2)                                  # 딥튜브
    for name, mat, y in parts:
        d.line([cx + 95, y, 700, y], fill=LINE, width=1)
        d.ellipse([cx + 92, y - 3, cx + 98, y + 3], fill=ACC)
        d.text((712, y - 10), name, font=f(16, True), fill=NAVY)
        d.text((930, y - 9), mat, font=f(14), fill=SUB)
    d.text((712, 740), "충전량 50ml ±3% · 펌프 토출량 표시량 ±10%", font=f(14), fill=SUB)
    d.text((712, 768), "캡 토크 8~14 kgf·cm · 용기 상용성 6개월 시험 적용", font=f(14), fill=SUB)
    d.text((712, 796), "관련 이슈: 펌프 토출 불량 (원인: 용기 상용성 불량)", font=f(14), fill=(170, 40, 40))
    im.save(os.path.join(OUT, "포장사양도해_CP305.png"))


def process_flow():
    im, d = canvas(1600, 700, "공정 흐름도", "O/W 유화 크림 표준 제조 공정 (CP-101 / CP-204 공통)")
    steps = [
        ("원료 칭량", "실온 · 2차 검증"), ("수상 용해", "75도 · 20분"), ("유상 용해", "75도 · 15분"),
        ("유화", "3,000 RPM · 10분"), ("냉각", "1.5도/분"), ("후첨", "40도 이하"),
        ("탈기·여과", "80메쉬"), ("충전", "32도 이하"), ("포장·검사", "전수 외관"),
    ]
    x, y, w, h = 40, 220, 150, 90
    for i, (name, cond) in enumerate(steps):
        bx = x + i * 172
        d.rounded_rectangle([bx, y, bx + w, y + h], 10, outline=NAVY, width=2, fill=BG)
        d.text((bx + 12, y + 22), name, font=f(16, True), fill=NAVY)
        d.text((bx + 12, y + 52), cond, font=f(12), fill=SUB)
        if i < len(steps) - 1:
            d.line([bx + w, y + h / 2, bx + 172, y + h / 2], fill=ACC, width=3)
            d.polygon([(bx + 172, y + h / 2), (bx + 162, y + h / 2 - 6), (bx + 162, y + h / 2 + 6)], fill=ACC)
    risks = [
        (3, "유화제 함량 부족 / HLB 불일치 → 상분리"),
        (3, "교반 속도 편차 → 점도 저하"),
        (4, "냉각 속도 과다 → 결정 석출"),
        (5, "보존제 함량 미달 → 미생물 한도 초과"),
        (7, "충전 온도 이탈 → 충전량 부족"),
    ]
    yy = 380
    for idx, txt in risks:
        bx = x + idx * 172 + w / 2
        d.line([bx, y + h, bx, yy], fill=(200, 120, 120), width=1)
        d.text((420, yy - 8), "▲ " + txt, font=f(14), fill=(170, 40, 40))
        yy += 34
    d.text((40, 600), "관리 포인트: 유화 온도 프로파일 · 교반 RPM 표준화 · 냉각 곡선 · 충전 온도 인터록", font=f(14), fill=SUB)
    im.save(os.path.join(OUT, "공정흐름도_유화크림.png"))


def defect_photo():
    im, d = canvas(1200, 800, "클레임 불량 사진(모사)", "CP-101 하이드라 수분크림 · 로트 CP101-2501A · 상분리")
    # 좌: 정상 / 우: 불량 — 사진 대신 도해로 모사
    for i, (title, sep) in enumerate([("정상품 (CP101-2504B)", False), ("불량품 (CP101-2501A)", True)]):
        ox = 80 + i * 560
        d.text((ox, 130), title, font=f(18, True), fill=NAVY if not sep else (170, 40, 40))
        d.rounded_rectangle([ox, 165, ox + 460, 640], 16, outline=NAVY, width=2, fill=(250, 250, 248))
        if sep:
            d.rectangle([ox + 2, 167, ox + 458, 330], fill=(238, 232, 205))   # 분리된 유상
            d.line([ox + 2, 330, ox + 458, 330], fill=(150, 130, 90), width=3)
            d.rectangle([ox + 2, 333, ox + 458, 638], fill=(246, 246, 244))   # 수상
            for k in range(9):
                d.ellipse([ox + 40 + k * 46, 360 + (k % 3) * 40, ox + 62 + k * 46, 382 + (k % 3) * 40],
                          outline=(190, 175, 130), width=2)
            d.text((ox + 20, 344), "유·수상 계면 형성", font=f(14), fill=(150, 60, 60))
        else:
            d.rectangle([ox + 2, 167, ox + 458, 638], fill=(250, 249, 246))
            d.text((ox + 20, 190), "균일한 백색 유화 상태", font=f(14), fill=SUB)
    d.text((80, 670), "측정: 상단부 유상 두께 약 6mm · 유화 입자경 3.4um (규격 1.0um 이하)", font=f(14), fill=SUB)
    d.text((80, 700), "추정 원인: 유화제 함량 부족 · 조치: 유화 공정 온도 프로파일 개정", font=f(14), fill=(170, 40, 40))
    im.save(os.path.join(OUT, "클레임불량사진_CP101_상분리.png"))


for fn in (label_mockup, pkg_spec, process_flow, defect_photo):
    fn()
    print("  png ", fn.__name__)

for n in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, n)
    with Image.open(p) as im:
        print(f"  {n}\t{im.size[0]}x{im.size[1]}\t{os.path.getsize(p) // 1024} KB")
