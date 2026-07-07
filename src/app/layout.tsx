import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "급매지도",
  description: "관심 지역 아파트 최저가·급매 매물 지도",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
