import Link from "next/link";

export default function WatchTabs({ on }: { on: "watch" | "compare" | "practice" }) {
  return (
    <nav className="segment" aria-label="관심종목 보기">
      <Link href="/watch" aria-current={on === "watch" ? "page" : undefined}>관심종목</Link>
      <Link href="/compare" aria-current={on === "compare" ? "page" : undefined}>종목 비교</Link>
      <Link href="/watch/practice" aria-current={on === "practice" ? "page" : undefined}>연습하기</Link>
    </nav>
  );
}
