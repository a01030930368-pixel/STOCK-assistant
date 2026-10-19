import type { Part } from "@/lib/summary";

export default function SummaryLine({ parts }: { parts: Part[] | undefined }) {
  if (!parts || parts.length === 0) return null;
  return (
    <div className="summary-line">
      {parts.map((p) => <span key={p.text} className={p.tone}>{p.text}</span>)}
    </div>
  );
}
