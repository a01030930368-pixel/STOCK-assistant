import type { Metadata, Viewport } from "next";
import Link from "next/link";
import MacroStrip from "./_components/MacroStrip";
import NavTabs from "./_components/NavTabs";
import "./globals.css";

export const metadata: Metadata = { title: "STOCK assistant", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b0b0d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">STOCK assistant</Link>
            <NavTabs />
          </div>
        </header>
        <MacroStrip />
        <main>{children}</main>
      </body>
    </html>
  );
}
