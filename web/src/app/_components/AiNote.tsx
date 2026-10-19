// AI 한마디 한 줄. 포트폴리오 옆 칸과 종목 페이지에서 같이 씁니다.
export type AiComment = { ticker: string; name?: string; day: string; tone: string; body: string };

const TONE: Record<string, string> = { 긍정: "up", 주의: "warn", 중립: "" };

export default function AiNote({ c, title }: { c: AiComment; title?: React.ReactNode }) {
  return (
    <div className="ai-note">
      <div className="row2">
        {title ?? <span />}
        <span className={`badge ${TONE[c.tone] ?? ""}`}>{c.tone}</span>
      </div>
      <p>{c.body}</p>
      <div className="meta">{Number(c.day.slice(5, 7))}.{Number(c.day.slice(8, 10))} 장 마감 뒤 · AI가 쓴 참고 메모예요</div>
    </div>
  );
}
