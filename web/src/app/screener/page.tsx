import Link from "next/link";
import { deletePreset, savePreset } from "@/app/actions";
import { query } from "@/lib/db";
import { describe, reasons, screen, type Rules, type ScreenStock } from "@/lib/screener";

export const dynamic = "force-dynamic";

type Preset = { id: number; name: string; rules: Rules };
type Row = {
  ticker: string; name: string; price: string; change_pct: string | null; trade_value: string; volume_ratio: string | null;
  rsi14: string | null; ma20_gap_pct: string | null; golden_cross: boolean; near_high_pct: string; spark: string[]; updated_at: Date;
};

const n = (v: string | null) => (v === null ? null : Number(v));
const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const signed = (v: number | null) => (v === null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const tone = (v: number | null) => (v === null || v === 0 ? "" : v > 0 ? "up" : "down");
function money(v: number) {
  const eok = Math.round(v / 1e8);
  if (eok >= 10000) return `${Math.floor(eok / 10000)}조 ${(eok % 10000).toLocaleString("ko-KR")}억`;
  return `${eok.toLocaleString("ko-KR")}억`;
}

export default async function ScreenerPage({ searchParams }: { searchParams: Promise<{ p?: string; edit?: string; new?: string }> }) {
  const sp = await searchParams;
  // 워커가 처음 돌기 전의 DB에는 검색기 테이블이 없을 수 있습니다.
  const presets = await query<Preset>("SELECT id, name, rules FROM screener_presets ORDER BY id").catch(() => [] as Preset[]);
  const rows = await query<Row>("SELECT * FROM screener_stocks WHERE market = 'KR'").catch(() => [] as Row[]);
  const stocks: ScreenStock[] = rows.map((r) => ({
    ticker: r.ticker, name: r.name, price: Number(r.price), changePct: n(r.change_pct), tradeValue: Number(r.trade_value),
    volumeRatio: n(r.volume_ratio), rsi14: n(r.rsi14), ma20GapPct: n(r.ma20_gap_pct), goldenCross: r.golden_cross,
    nearHighPct: Number(r.near_high_pct), spark: r.spark.map(Number),
  }));
  const updated = rows.reduce<Date | null>((a, r) => (!a || r.updated_at > a ? r.updated_at : a), null);
  const results = new Map(presets.map((p) => [p.id, screen(stocks, p.rules)]));
  const selected = presets.find((p) => String(p.id) === sp.p) ?? presets[0];
  const list = selected ? results.get(selected.id)! : [];
  const creating = sp.new === "1" || presets.length === 0;
  const editing = !creating && sp.edit === "1" && selected;

  return (
    <>
      <div className="board-head">
        <div className="screener-title">
          <h1>검색기</h1>
          <span className="muted">
            {updated
              ? `국내 거래대금 상위 ${stocks.length}종목 중 · ${updated.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 기준`
              : "저장한 조건마다 오늘 걸린 종목 수를 보여 줘요"}
          </span>
        </div>
        <Link href="/screener?new=1" className="button">+ 새 조건</Link>
      </div>

      {stocks.length === 0 && (
        <p className="muted">아직 종목 데이터가 없어요. 키움 키가 들어 있으면 워커가 장중 30분마다, 장 마감 뒤 한 번 더 국내 거래대금 상위 200종목을 계산해 채워요.</p>
      )}

      {creating && <PresetForm title="새 조건 만들기" />}

      <div className="preset-cards">
        {presets.map((p) => {
          const hits = results.get(p.id)!;
          const on = p.id === selected?.id;
          return (
            <Link key={p.id} href={`/screener?p=${p.id}`} className={on ? "panel preset-card on" : "panel preset-card"} aria-current={on ? "true" : undefined}>
              <div className="preset-head">
                <b>{p.name}</b>
                <span className="preset-count">{hits.length}</span><span className="muted">종목</span>
              </div>
              <div className="preset-desc">{describe(p.rules)}</div>
              {hits.slice(0, 3).map((s) => (
                <div key={s.ticker} className="preset-line"><span>{s.name}</span><span className={tone(s.changePct)}>{signed(s.changePct)}</span></div>
              ))}
              {hits.length === 0 && <div className="preset-line muted">오늘은 걸린 종목이 없어요</div>}
            </Link>
          );
        })}
      </div>

      {selected && (
        <section className="panel flush screener-result">
          <div className="panel-title">
            <span>{selected.name} · {list.length}종목</span>
            <span className="muted">
              <Link href={editing ? `/screener?p=${selected.id}` : `/screener?p=${selected.id}&edit=1`}>{editing ? "수정 닫기" : "조건 수정"}</Link>
            </span>
          </div>
          {editing && (
            <div className="screener-edit">
              <PresetForm title="조건 수정" preset={selected} />
              <form action={deletePreset}>
                <input type="hidden" name="id" value={selected.id} />
                <button type="submit" className="ghost">이 조건 지우기</button>
              </form>
            </div>
          )}
          {list.length === 0 ? (
            <p className="muted screener-empty">지금은 이 조건에 맞는 종목이 없어요.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>종목</th><th className="num">현재가</th><th className="num">등락률</th><th className="num">거래대금</th>
                    <th className="num">RSI</th><th className="num">20일선 대비</th><th className="num">거래량(20일 평균 대비)</th><th>걸린 조건</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.ticker}>
                      <td>
                        <a href={`https://finance.naver.com/item/main.naver?code=${s.ticker}`} target="_blank" rel="noreferrer" className="stock-link">{s.name}</a>{" "}
                        <span className="muted code">{s.ticker}</span>
                      </td>
                      <td className="num">{won(s.price)}</td>
                      <td className={`num ${tone(s.changePct)}`}>{signed(s.changePct)}</td>
                      <td className="num">{money(s.tradeValue)}</td>
                      <td className={`num ${s.rsi14 !== null && s.rsi14 <= 30 ? "down" : s.rsi14 !== null && s.rsi14 >= 70 ? "up" : ""}`}>{s.rsi14 === null ? "-" : s.rsi14.toFixed(0)}</td>
                      <td className={`num ${tone(s.ma20GapPct)}`}>{signed(s.ma20GapPct)}</td>
                      <td className="num">{s.volumeRatio === null ? "-" : `${s.volumeRatio.toFixed(1)}배`}</td>
                      <td>{reasons(s, selected.rules).map((r) => <span key={r} className="badge gold tag">{r}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <p className="muted screener-note">종목 이름을 누르면 네이버 금융이 열려요. 미국 종목은 데이터 출처를 확인한 뒤 붙일 예정이에요.</p>
    </>
  );
}

function PresetForm({ title, preset }: { title: string; preset?: Preset }) {
  const r = preset?.rules ?? {};
  const v = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
  return (
    <form action={savePreset} className="panel preset-form">
      <div className="panel-title"><span>{title}</span><span className="muted">빈칸은 조건에서 빠져요</span></div>
      {preset && <input type="hidden" name="id" value={preset.id} />}
      <label className="wide">이름<input name="name" defaultValue={preset?.name ?? ""} placeholder="예: 거래대금 터진 종목" maxLength={40} required /></label>
      <label>거래대금 (억 원 이상)<input name="minValueEok" inputMode="numeric" defaultValue={v(r.minValueEok)} placeholder="예: 1500" /></label>
      <label>등락률 (% 이상)<input name="chgMin" inputMode="decimal" defaultValue={v(r.chgMin)} placeholder="예: -5" /></label>
      <label>등락률 (% 이하)<input name="chgMax" inputMode="decimal" defaultValue={v(r.chgMax)} placeholder="예: 10" /></label>
      <label>거래량 (20일 평균의 몇 배 이상)<input name="volRatioMin" inputMode="decimal" defaultValue={v(r.volRatioMin)} placeholder="예: 1.5" /></label>
      <label>RSI (이상)<input name="rsiMin" inputMode="numeric" defaultValue={v(r.rsiMin)} placeholder="예: 70" /></label>
      <label>RSI (이하)<input name="rsiMax" inputMode="numeric" defaultValue={v(r.rsiMax)} placeholder="예: 30" /></label>
      <label>20일 이동평균선
        <select name="ma20" defaultValue={r.ma20 ?? ""}>
          <option value="">상관없음</option>
          <option value="above">위에 있음</option>
          <option value="below">아래에 있음</option>
        </select>
      </label>
      <label>52주 최고가에서 (% 이내)<input name="nearHighPct" inputMode="decimal" defaultValue={v(r.nearHighPct)} placeholder="예: 5" /></label>
      <label className="check"><input type="checkbox" name="goldenCross" defaultChecked={!!r.goldenCross} /> 골든크로스 (최근 3일 안에 5일선이 20일선 위로)</label>
      <div className="wide form-actions"><button type="submit">저장</button>{!preset && <Link href="/screener" className="muted">취소</Link>}</div>
    </form>
  );
}
