import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Logo from "./_components/Logo";
import MacroStrip from "./_components/MacroStrip";
import NavTabs from "./_components/NavTabs";
import "./globals.css";

export const metadata: Metadata = { title: "LODESTAR", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b0b0d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand"><Logo /><span>LODESTAR</span></Link>
            <NavTabs />
          </div>
        </header>
        <MacroStrip />
        <main>{children}</main>
      </body>
    </html>
  );
}
