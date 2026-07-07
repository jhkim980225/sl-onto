import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SL OntoGround — FMEA 지식 온톨로지 워크벤치",
  description: "흩어진 FMEA 문서를 온톨로지로 적재하고 신규 설계 리스크를 근거·확신도와 함께 추론",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
