# FEDA OntoGround — Next.js standalone 단일 이미지
# 어떤 회사 클라우드든 배포 (Cloud Run / ECS / App Service / K8s). docs/deployment.md

# ── 1) 빌드 ──
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# output:'standalone' + outputFileTracingIncludes(data/sources) 로 최소 번들 생성
RUN npm run build

# ── 2) 런타임 ──
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# standalone 서버(+트레이싱된 node_modules·data/sources) 와 정적 자산
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# 정적 퍼블릭 자산(취약점 리포트 이미지 등) — standalone 은 public/ 을 자동 포함하지 않는다
COPY --from=builder /app/public ./public
# 인제스천이 런타임에 읽는 원천 파일 (트레이싱 보완용 명시 복사)
COPY --from=builder /app/data ./data

# 클라우드 런타임이 $PORT 를 주입한다. 없으면 8000.
ENV PORT=8000
EXPOSE 8000
# standalone 은 server.js 를 생성한다. 호스트 0.0.0.0 로 바인딩.
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
