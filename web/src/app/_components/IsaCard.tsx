import { saveIsa } from "@/app/actions";
import { fixedPct, signClass, won } from "@/lib/format";
import { maturity, taxFree, TYPE_LABEL, YEAR_LIMIT, yearPct, type IsaSettings } from "@/lib/isa";

type Summary = { total_eval: string; total_pnl: string; total_pnl_pct: string };
type Cash = { deposit: string; d2_deposit: string | null; orderable: string | null };
export type IsaStatus = { at: string; ok: boolean; error?: string };

const krw = (v: number | string) => `${won(v)}원`;
const signed = (v: number, text: string) => (v > 0 ? `+${text}` : text);
const man = (v: number) => `${won(Math.round(v / 10_000))}만원`;

export default function IsaCard({ dim, summary, cash, bought, settings, status, today }: {
  dim: boolean; summary: Summary | undefined; cash: Cash | undefined; bought: number;
  settings: IsaSettings; status: IsaStatus | null; today: string;
}) {
  const pnl = Number(summary?.total_pnl ?? 0);
  const tax = taxFree(pnl, settings.type);
  const due = settings.opened ? maturity(settings.opened, today) : null;
  return (
    <div className={`panel account isa${dim ? " dim" : ""}`}>
      <div className="panel-title">
        ISA 계좌 <span className="muted">{TYPE_LABEL[settings.type]}{settings.opened ? ` · ${settings.opened.slice(0, 7).replace("-", ".")} 개설` : ""}</span>
      </div>
      {summary ? (
        <dl>
          <dt>주식 평가</dt><dd>{krw(summary.total_eval)}</dd>
          <dt>평가손익</dt>
          <dd className={signClass(summary.total_pnl)}>
            {signed(pnl, krw(summary.total_pnl))} <span className="muted">({signed(Number(summary.total_pnl_pct), fixedPct(summary.total_pnl_pct))})</span>
          </dd>
          <dt>남은 예수금</dt>
          <dd className="cash">{cash ? krw(cash.d2_deposit ?? cash.deposit) : "확인 중"}</dd>
        </dl>
      ) : status && !status.ok ? (
        <div className="muted">ISA 잔고를 못 불러왔어요: {status.error}</div>
      ) : (
        <div className="muted">아직 ISA 잔고를 불러오지 않았습니다. 장이 열려 있을 때 1분 안에 채워져요.</div>
      )}
      <div className="isa-meter">
        <div className="label">올해 산 금액 {man(bought)} / 납입 한도 {man(YEAR_LIMIT)}</div>
        <div className="meter"><i style={{ width: `${yearPct(bought)}%` }} /></div>
      </div>
      {summary && (
        <div className="isa-meter">
          <div className="label">비과세 한도까지 ({TYPE_LABEL[settings.type]} {man(tax.limit)})</div>
          <div className="meter green"><i style={{ width: `${tax.pct}%` }} /></div>
          <div className="foot">
            {tax.over > 0
              ? `평가이익 중 ${krw(tax.over)}은 한도를 넘어 9.9% 분리과세 대상이에요`
              : `지금 평가이익 ${krw(tax.gain)}은 모두 비과세 범위예요`}
          </div>
        </div>
      )}
      <div className="foot">
        {due ? (due.daysLeft > 0 ? `의무 기간 3년 · ${due.day.replace(/-/g, ".")} 만기까지 ${won(due.daysLeft)}일` : "의무 기간 3년이 지났어요") : "개설일을 넣으면 만기까지 남은 날을 보여 줘요"}
      </div>
      <details className="isa-set">
        <summary>유형·개설일 바꾸기</summary>
        <form action={saveIsa}>
          <select name="type" defaultValue={settings.type} aria-label="ISA 유형">
            <option value="general">일반형 (비과세 200만원)</option>
            <option value="low">서민·농어민형 (비과세 400만원)</option>
          </select>
          <input type="date" name="opened" defaultValue={settings.opened ?? ""} aria-label="개설일" />
          <button type="submit">저장</button>
        </form>
      </details>
      <div className="foot">올해 산 금액은 ISA 체결 기록의 매수 금액으로 셈해요. 작년에 못 채운 한도는 이월돼요.</div>
    </div>
  );
}
