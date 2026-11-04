import Link from "next/link";

// 연습하기 안의 작은 탭: 연습하기 | 기록 | 실험실
export default function PracticeTabs({ on, count }: { on: "play" | "log" | "lab"; count?: number }) {
  return (
    <nav className="segment practice-tabs" aria-label="연습하기 보기">
      <Link href="/watch/practice" aria-current={on === "play" ? "page" : undefined}>연습하기</Link>
      <Link href="/watch/practice/log" aria-current={on === "log" ? "page" : undefined}>기록{!!count && <span className="muted">{count}</span>}</Link>
      <Link href="/watch/practice/lab" aria-current={on === "lab" ? "page" : undefined}>실험실</Link>
    </nav>
  );
}
