import Link from "next/link";

export default function MacroTabs({ on }: { on: "indicators" | "sectors" }) {
  return (
    <nav className="segment" aria-label="매크로 보기">
      <Link href="/macro" aria-current={on === "indicators" ? "page" : undefined}>지표·메모</Link>
      <Link href="/macro/sectors" aria-current={on === "sectors" ? "page" : undefined}>섹터 동향</Link>
    </nav>
  );
}
