// 매수 전 한 장 요약: 종목 페이지에 이미 있는 자료로 6칸(실적·수급·차트 위치·값어치·소식·조심할 점)을 계산해요.
// 숫자와 신호등 색은 여기서 정하고, 워커(worker/app/brief.py)의 AI는 한 줄 결론과 좋은 점·걱정되는 점 문장만 써요.
import { buildBand, perShare, times } from "./bands";
import { bollinger, rsi, sma, type Candle } from "./candles";
import { KIND } from "./disclosures";
import { change, title as reportTitle, type Report } from "./earnings";
import { money as flowMoney, streak, total, type FlowRow } from "./flows";
import { money, previousKey, quarterLabel, tableOf, type StatementRow } from "./statements";

export type Signal = "g" | "y" | "r" | "n";
export type Cell = { key: string; title: string; signal: Signal; text: string };
export type BriefFiling = { kind: string; day: string };
export type BriefEvent = { day: string; kind: string; title: string; ticker: string };
export type BriefInput = {
  market: string; price: number | null; today: string;
  candles: Candle[]; statements: StatementRow[]; shares: number | null; report: Report | null;
  flows: FlowRow[]; filings: BriefFiling[]; newsDays: string[]; events: BriefEvent[];
};

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;
const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const md = (day: string) => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;

// 1년 전보다 얼마나 늘었나로 색을 정해요: +10% 이상 초록, −10%까지 노랑, 그보다 나쁘면 빨강
function growthSignal(cur: number, base: number | null): Signal {
  if (cur <= 0) return "r";
  if (base === null) return "y";
  if (base <= 0) return "g"; // 흑자 전환
  const p = (cur / base - 1) * 100;
  return p >= 10 ? "g" : p > -10 ? "y" : "r";
}

export function earningsCell(i: Pick<BriefInput, "report" | "statements" | "market">): Cell {
  const title = "실적";
  const r = i.report;
  if (r) {
    const key = (["operating_income", "net_income", "revenue"] as const).find((k) => r.data.lines[k]?.cur != null);
    const line = key ? r.data.lines[key]! : null;
    if (key && line && line.cur !== null) {
      const label = key === "operating_income" ? "영업이익" : key === "net_income" ? "순이익" : "매출";
      const ch = change(line.cur, line.yoy);
      const eps = r.data.eps;
      const beat = eps?.actual != null && eps.estimate ? (eps.actual >= eps.estimate ? " 예상보다 잘 나왔어요." : " 예상보다 못 나왔어요.") : "";
      return {
        key: "earnings", title, signal: growthSignal(line.cur, line.yoy ?? null),
        text: `${reportTitle(r)}: ${label} ${money(line.cur, r.market)}${ch ? `, 1년 전보다 ${ch.text}` : ""}.${beat}`,
      };
    }
  }
  const t = tableOf(i.statements, "Q");
  const cols = t.columns.map((c) => c.key);
  const last = cols.at(-1);
  if (last) {
    const cur = t.get(last, "operating_income");
    // 1년 전 분기는 표 열(최근 5분기) 밖일 수 있어 전체 행에서 찾아요.
    const yearAgo = (k: string) => {
      const pk = previousKey(k);
      return pk ? i.statements.find((s) => `${s.kind}:${s.period}` === pk && s.item === "operating_income")?.value ?? null : null;
    };
    const base = yearAgo(last);
    if (cur !== null) {
      const ch = change(cur, base);
      // 1년 전 같은 분기보다 몇 분기째 늘었나
      let streakN = 0;
      for (const k of [...cols].reverse()) {
        const v = t.get(k, "operating_income"), b = yearAgo(k);
        if (v === null || b === null || !(v > b)) break;
        streakN++;
      }
      return {
        key: "earnings", title, signal: growthSignal(cur, base),
        text: `${quarterLabel(last.slice(2))} 영업이익 ${money(cur, i.market)}${ch ? `, 1년 전보다 ${ch.text}` : ""}.${streakN >= 2 ? ` ${streakN}분기 연속 늘었어요.` : ""}`,
      };
    }
  }
  return { key: "earnings", title, signal: "n", text: "아직 받은 실적 자료가 없어요." };
}

export function flowCell(i: Pick<BriefInput, "flows" | "market">): Cell {
  const title = "수급";
  if (i.market !== "KR") return { key: "flow", title, signal: "n", text: "미국 종목은 외국인·기관 수급 자료가 없어요." };
  const rows = i.flows.slice(-20);
  if (rows.length < 5) return { key: "flow", title, signal: "n", text: "수급 자료를 아직 받는 중이에요." };
  const f = total(rows, "foreign"), inst = total(rows, "institution");
  const s = streak(rows, "foreign");
  const run = s >= 3 ? ` 외국인이 ${s}일 연속 사는 중이에요.` : s <= -3 ? ` 외국인이 ${-s}일 연속 파는 중이에요.` : "";
  return {
    key: "flow", title, signal: f > 0 && inst > 0 ? "g" : f < 0 && inst < 0 ? "r" : "y",
    text: `최근 ${rows.length}일 외국인 ${flowMoney(f)}, 기관 ${flowMoney(inst)}.${run}`,
  };
}

export function chartCell(i: Pick<BriefInput, "candles" | "price">): Cell {
  const title = "차트 위치";
  const closes = i.candles.map((c) => c.close);
  if (closes.length < 60) return { key: "chart", title, signal: "n", text: "일봉이 아직 적어 계산을 못 했어요." };
  const last = i.price ?? closes.at(-1)!;
  const year = closes.slice(-250);
  const high = Math.max(...year, last);
  const ma20 = sma(closes, 20).at(-1)!, ma60 = sma(closes, 60).at(-1)!;
  const bb = bollinger(closes).at(-1)!;
  const r = rsi(closes).at(-1) ?? null;
  const fromHigh = (last / high - 1) * 100;
  const hot = (r !== null && r >= 70) || last >= bb.upper;
  const pos = fromHigh > -1 ? "52주 고점 부근" : `52주 고점보다 ${signed(fromHigh)}`;
  const ma = last >= ma20 ? "20일선 위" : last >= ma60 ? "20일선 아래, 60일선 위" : "20일선·60일선 아래";
  let tail = "";
  if (hot) tail = r !== null && r >= 70 ? ` RSI ${Math.round(r)}로 단기로는 많이 오른 편이에요.` : " 볼린저 상단에 닿아 단기로는 많이 오른 편이에요.";
  else if (r !== null && r <= 30) tail = ` RSI ${Math.round(r)}로 많이 빠진 편이에요.`;
  const signal: Signal = last < ma20 && last < ma60 ? "r" : hot || last < ma20 ? "y" : "g";
  return { key: "chart", title, signal, text: `${pos}이고 ${ma}에 있어요.${tail}` };
}

export function valueCell(i: Pick<BriefInput, "candles" | "statements" | "shares" | "price">): Cell {
  const title = "값어치";
  if (i.shares && i.candles.length > 0) {
    for (const kind of ["per", "pbr"] as const) {
      const band = buildBand(i.candles, perShare(i.statements, i.shares, kind), 5, i.price);
      if (band && band.current !== null && band.current > 0 && band.position !== null) {
        const name = kind === "per" ? "PER" : "PBR";
        const where = band.position >= 80 ? "비싼 쪽" : band.position <= 30 ? "싼 쪽" : "중간쯤";
        // PBR로 넘어온 이유: 최근 4분기 순이익이 0 이하면 적자, 아니면 순이익 자료가 모자라서
        const eps = kind === "pbr" ? perShare(i.statements, i.shares, "per").at(-1)?.value ?? null : null;
        const lossy = kind === "per" ? "" : eps !== null && eps <= 0 ? " (적자라 PER 대신 PBR로 봤어요)" : " (순이익 자료가 모자라 PER 대신 PBR로 봤어요)";
        return {
          key: "value", title, signal: band.position <= 40 ? "g" : band.position <= 75 ? "y" : "r",
          text: `${name} ${times(band.current)}, 지난 5년 중 낮은 순 ${band.position}% 자리라 ${where}이에요.${lossy}`,
        };
      }
    }
  }
  return { key: "value", title, signal: "n", text: "주식 수나 재무가 아직 없어 PER·PBR을 계산하지 못했어요." };
}

const BAD = new Set(["halt", "rights", "cb", "reduce"]);
export function newsCell(i: Pick<BriefInput, "filings" | "newsDays" | "today" | "market">): Cell {
  const title = "최근 소식";
  const since = addDays(i.today, -30), week = addDays(i.today, -7);
  const recent = i.filings.filter((f) => f.day >= since && f.kind !== "stake" && f.kind !== "other");
  const news = i.newsDays.filter((d) => d >= week).length;
  const labels = [...new Set(recent.map((f) => KIND[f.kind]?.label ?? f.kind))];
  const warn = recent.filter((f) => KIND[f.kind]?.tone === "warn");
  const parts = [];
  if (i.market === "KR") parts.push(recent.length ? `30일 공시 ${recent.length}건(${labels.slice(0, 3).join(", ")})` : "30일 동안 눈에 띄는 공시는 없어요");
  parts.push(`7일 뉴스 ${news}건`);
  const signal: Signal = recent.some((f) => BAD.has(f.kind)) ? "r" : warn.length ? "y" : "g";
  const tail = signal === "r" ? " 주식 수가 바뀔 수 있는 공시가 있어요." : signal === "y" ? ` ${KIND[warn[0].kind].label} 공시를 확인해 보세요.` : "";
  return { key: "news", title, signal, text: `${parts.join(", ")}.${tail}` };
}

export function cautionCell(i: Pick<BriefInput, "events" | "candles" | "price" | "today">): Cell {
  const title = "조심할 점";
  const items: string[] = [];
  const soon = addDays(i.today, 14), week = addDays(i.today, 7);
  for (const e of i.events) {
    if (e.day < i.today) continue;
    if (e.ticker && e.kind === "earnings" && e.day <= soon) items.push(`${md(e.day)} 실적 발표`);
    else if (!e.ticker && e.kind === "policy" && e.day <= week) items.push(`${md(e.day)} ${e.title}`);
  }
  const closes = i.candles.map((c) => c.close);
  if (closes.length >= 22) {
    const m = ((i.price ?? closes.at(-1)!) / closes[closes.length - 22] - 1) * 100;
    if (m >= 20) items.push(`한 달 ${signed(m)} 많이 올랐어요`);
    else if (m <= -20) items.push(`한 달 ${signed(m)} 많이 빠졌어요`);
  }
  const uniq = [...new Set(items)].slice(0, 3);
  return uniq.length
    ? { key: "caution", title, signal: "y", text: `${uniq.join(", ")}.` }
    : { key: "caution", title, signal: "g", text: "2주 안에 실적 발표나 큰 금리 일정이 없어요." };
}

export function buildCells(i: BriefInput): Cell[] {
  return [earningsCell(i), flowCell(i), chartCell(i), valueCell(i), newsCell(i), cautionCell(i)];
}

export function counts(cells: Cell[]): string {
  const n = (s: Signal) => cells.filter((c) => c.signal === s).length;
  return [`초록 ${n("g")}`, `노랑 ${n("y")}`, `빨강 ${n("r")}`].join(" · ");
}
