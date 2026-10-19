import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "STOCK assistant", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f4fd1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <nav>
          <Link href="/">포트폴리오</Link>
          <Link href="/journal">매매일지</Link>
          <Link href="/macro">매크로</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
