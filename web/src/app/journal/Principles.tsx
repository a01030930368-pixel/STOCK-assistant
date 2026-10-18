import { addPrinciple, deletePrinciple } from "@/app/actions";
import { query } from "@/lib/db";

type Principle = { id: number; kind: "trading" | "crisis"; body: string };

// 매매일지 탭 어디서든 항상 보이는 원칙 영역.
export default async function Principles({ editable = false }: { editable?: boolean }) {
  const rows = await query<Principle>("SELECT id, kind, body FROM principles ORDER BY sort_order, id");
  const group = (kind: Principle["kind"]) => rows.filter((r) => r.kind === kind);

  return (
    <section className="card">
      {(["trading", "crisis"] as const).map((kind) => (
        <div key={kind}>
          <strong>{kind === "trading" ? "내 매매원칙" : "위기 대응 원칙"}</strong>
          {group(kind).length === 0 && <p className="muted">아직 없습니다.</p>}
          <ul className="principles">
            {group(kind).map((p) => (
              <li key={p.id}>
                {p.body}{" "}
                {editable && (
                  <form action={deletePrinciple} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="ghost" type="submit">삭제</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {editable && (
        <form action={addPrinciple} className="row" style={{ marginTop: 12 }}>
          <select name="kind" defaultValue="trading">
            <option value="trading">매매원칙</option>
            <option value="crisis">위기 대응 원칙</option>
          </select>
          <input name="body" placeholder="원칙 추가" required />
          <button type="submit">추가</button>
        </form>
      )}
    </section>
  );
}
