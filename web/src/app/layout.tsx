import type { Metadata, Viewport } from "next";
import Link from "next/link";
import NavTabs from "./_components/NavTabs";
import "./globals.css";

export const metadata: Metadata = { title: "STOCK assistant", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#2f5bea" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">STOCK assistant</Link>
            <NavTabs />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
