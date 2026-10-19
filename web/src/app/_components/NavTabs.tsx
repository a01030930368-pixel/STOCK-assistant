"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICON = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  journal: "M6 3h10l4 4v14H6zM9 9h6M9 13h8M9 17h5",
  macro: "M4 19V9M10 19V5M16 19v-7M22 19H2",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
};

const TABS = [
  { href: "/", label: "포트폴리오", icon: ICON.home, match: (p: string) => p === "/" || p.startsWith("/stock") },
  { href: "/journal", label: "매매일지", icon: ICON.journal, match: (p: string) => p.startsWith("/journal") },
  { href: "/screener", label: "검색기", icon: ICON.search, match: (p: string) => p.startsWith("/screener") },
  { href: "/calendar", label: "일정", icon: ICON.calendar, match: (p: string) => p.startsWith("/calendar") },
  { href: "/macro", label: "매크로", icon: ICON.macro, match: (p: string) => p.startsWith("/macro") },
];

export default function NavTabs() {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.match(path) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={t.icon} />
          </svg>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
