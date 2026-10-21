"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { askHistory } from "@/app/actions";

// 일봉이 없는 종목을 워커에게 받아 달라고 한 번 남기고, 받을 때까지 20초마다 화면을 새로 그려요(최대 3분).
export default function AskHistory({ items, pending }: { items: [string, "KR" | "US"][]; pending: string[] }) {
  const router = useRouter();
  const asked = useRef(false);
  const key = items.map(([t]) => t).join(",");
  useEffect(() => {
    if (!key) return;
    if (!asked.current) {
      asked.current = true;
      const fresh = items.filter(([t]) => !pending.includes(t));
      if (fresh.length) askHistory(fresh);
    }
    let n = 0;
    const id = setInterval(() => { if (++n > 9) clearInterval(id); router.refresh(); }, 20000);
    return () => clearInterval(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
