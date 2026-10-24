import Link from "next/link";

// 연습하기 안의 작은 탭: 새로 연습하기 | 지난 기록
export default function PracticeTabs({ on, count }: { on: "play" | "log"; count: number }) {
  return (
    <nav className="segment practice-tabs" aria-label="연습하기 보기">
      <Link href="/watch/practice" aria-current={on === "play" ? "page" : undefined}>연습하기</Link>
      <Link href="/watch/practice/log" aria-current={on === "log" ? "page" : undefined}>기록{count > 0 && <span className="muted">{count}</span>}</Link>
    </nav>
  );
}
