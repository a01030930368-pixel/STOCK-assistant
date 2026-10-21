"use client";
import { useRouter } from "next/navigation";

export default function BookPicker({ books, value }: { books: { key: string; label: string }[]; value: string }) {
  const router = useRouter();
  return (
    <select className="replay-pick" value={value} aria-label="복기할 종목" onChange={(e) => router.push(`/journal/replay?b=${encodeURIComponent(e.target.value)}`)}>
      {books.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
    </select>
  );
}
