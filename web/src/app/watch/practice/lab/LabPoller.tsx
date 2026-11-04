"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { readLabStatus } from "@/app/actions";

// 돌리는 중인 규칙이 끝나면 화면을 새로 그려요.
export default function LabPoller({ ids }: { ids: number[] }) {
  const router = useRouter();
  const key = ids.join(",");
  useEffect(() => {
    let gone = false;
    const list = key.split(",").map(Number);
    const tick = async () => {
      const rows = await readLabStatus(list).catch(() => []);
      if (gone) return;
      if (rows.length < list.length || rows.some((r) => r.status === "done" || r.status === "error")) router.refresh();
    };
    const t = setInterval(tick, 3000);
    return () => { gone = true; clearInterval(t); };
  }, [key, router]);
  return null;
}
