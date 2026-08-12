import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/static/Pretendard-ExtraBold.css";
import "@noonnu/nanum-square-round";
import "@noonnu/noto-sans-kr";
import "@noonnu/gmarket-sans-medium";
import "@noonnu/tmoney-round-wind-extra-bold";
import "@kfonts/bm-dohyeon";
import "@kfonts/bm-hanna-pro";
import "@kfonts/bm-jua";
import "@noonnu/cafe24-dangdanghae";
import "@noonnu/yg-jalnan";
import "./globals.css";

export const metadata: Metadata = {
  title: "Instagram Reels Generator",
  description: "TTS 기반 릴스 소재 준비 도구",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
