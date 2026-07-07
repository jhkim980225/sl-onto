/** @type {import('next').NextConfig} */
const nextConfig = {
  // 단일 이미지로 어떤 회사 클라우드든 배포 (Cloud Run / ECS / App Service / K8s)
  output: "standalone",
  // 인제스천이 런타임에 읽는 원천 파일을 standalone 번들에 포함
  outputFileTracingIncludes: {
    "/**": ["./data/sources/**"],
  },
};

export default nextConfig;
