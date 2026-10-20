import Link from "next/link";

export default function JournalTabs({ on }: { on: "list" | "books" | "stats" }) {
  return (
    <nav className="segment" aria-label="매매일지 보기">
      <Link href="/journal" aria-current={on === "list" ? "page" : undefined}>기록</Link>
      <Link href="/journal/books" aria-current={on === "books" ? "page" : undefined}>일기장</Link>
      <Link href="/journal/stats" aria-current={on === "stats" ? "page" : undefined}>통계</Link>
    </nav>
  );
}
