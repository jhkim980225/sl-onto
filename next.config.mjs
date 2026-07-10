/** @type {import('next').NextConfig} */
const nextConfig = {
  // 단일 이미지로 어떤 회사 클라우드든 배포 (Cloud Run / ECS / App Service / K8s)
  output: "standalone",
  // 주의: compress 는 standalone Route Handler 응답에 적용 안 됨(실측) — 큰 응답은 라우트에서 직접 gzip
  // (app/api/ontology/route.ts). 앞단 ingress 생기면 그쪽 gzip 으로 대체.
  // 인제스천이 런타임에 읽는 원천 파일 + fs 로 읽는 스키마 SQL 을 standalone 번들에 포함
  outputFileTracingIncludes: {
    "/**": ["./data/sources/**", "./lib/db/**/*.sql"],
  },
};

export default nextConfig;
