import Link from "next/link";
import { saveReview } from "@/app/actions";
import { BOOK_SORTS, findBook, isBookSort, onShelf, shortDay, sortBooks, type Book, type Page, type Shelf } from "@/lib/books";
import { buyPlans, loadBooks, loadBookSort, loadEdits, loadReviews, saveBookSort, type Review } from "@/lib/booksData";
import { signClass, today, usd, won } from "@/lib/format";
import JournalTabs from "../JournalTabs";

export const dynamic = "force-dynamic";

const SHELVES: { key: Shelf; label: string }[] = [
  { key: "all", label: "전체" }, { key: "open", label: "진행 중" }, { key: "closed", label: "끝남" }, { key: "unreviewed", label: "강평 안 쓴 것" },
];

const money = (b: Book, v: number) => (b.market === "US" ? usd(v) : `${won(v)}원`);
const signed = (b: Book, v: number) => `${v > 0 ? "+" : ""}${money(b, v)}`;
const pct = (v: number | null) => (v === null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const qty = (v: number) => won(v, 4);
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

export default async function BooksPage({ searchParams }: { searchParams: Promise<{ b?: string; s?: string; edit?: string; o?: string }> }) {
  const params = await searchParams;
  const shelf = SHELVES.find((x) => x.key === params.s)?.key ?? "all";
  const [books, reviews, edits, saved] = await Promise.all([loadBooks(), loadReviews(), loadEdits(), loadBookSort()]);
  // 정렬을 누르면 그 순서를 저장해 두고, 다음에 열 때도 그대로 써요.
  const sort = isBookSort(params.o) ? params.o : saved;
  if (sort !== saved) await saveBookSort(sort).catch(() => undefined);
  const day = today();
  const edited = (b: Book) => {
    const times = b.pages.filter((p) => p.entryId !== null).map((p) => edits.get(`${p.side}:${p.entryId}`) ?? "");
    const r = reviews.get(b.key)?.edited;
    return [...times, r ?? ""].reduce((a, x) => (x > a ? x : a), "") || null;
  };
  const shown = sortBooks(books.filter((b) => onShelf(b, shelf, (k) => reviews.has(k))), sort, { stars: (k) => reviews.get(k)?.stars ?? null, edited });
  const open = findBook(books, params.b);
  const href = (q: { b?: string; s?: Shelf; o?: string }) => {
    const sp = new URLSearchParams();
    if (q.b) sp.set("b", q.b);
    if (q.s && q.s !== "all") sp.set("s", q.s);
    if (q.o) sp.set("o", q.o);
    return `/journal/books${sp.size ? `?${sp}` : ""}`;
  };

  return (
    <>
      <div className="board-head">
        <h1>매매일지</h1>
        <JournalTabs on="books" />
        <nav className="shelf-filter" aria-label="책장 고르기">
          {SHELVES.map((x) => (
            <Link key={x.key} className={x.key === shelf ? "chip-btn on" : "chip-btn"} href={href({ b: open?.key, s: x.key })}>{x.label}</Link>
          ))}
        </nav>
      </div>
      <div className={open ? "shelf-wrap has-book" : "shelf-wrap"}>
        <div className="shelf">
          <nav className="segment small shelf-sort" aria-label="정렬">
            {BOOK_SORTS.map((x) => (
              <Link key={x.key} aria-current={x.key === sort ? "page" : undefined} href={href({ b: open?.key, s: shelf, o: x.key })}>{x.label}</Link>
            ))}
          </nav>
          {shown.length === 0 && <p className="muted">{books.length ? "여기에 해당하는 일기장이 없어요." : "아직 일기장이 없어요. 키움 체결을 받아 오면 종목마다 한 권씩 생겨요."}</p>}
          {shown.map((b) => (
            <Link key={b.key} href={href({ b: b.key, s: shelf })} className={`book${b.end ? "" : " open"}${b.key === open?.key ? " on" : ""}`}>
              <span className="book-top"><b>{b.name}</b><span className={`num ${signClass(b.returnPct ?? 0)}`}>{pct(b.returnPct)}</span></span>
              <span className="muted book-days">{period(b, day)}</span>
              <span className={reviews.get(b.key)?.stars ? "star" : "muted"}>
                {b.end ? (reviews.get(b.key)?.stars ? stars(reviews.get(b.key)!.stars!) : reviews.has(b.key) ? "강평 씀" : "강평 안 씀") : `지금 ${qty(b.held)}주 보유`}
              </span>
            </Link>
          ))}
        </div>
        <div className="book-view">
          {open ? (
            <BookView b={open} review={reviews.get(open.key)} editing={params.edit === "review"} back={href({ s: shelf })} day={day} />
          ) : (
            <p className="muted">왼쪽 책장에서 한 권을 고르면 여기에 펼쳐져요. 한 권은 그 종목을 처음 산 날부터 전부 판 날까지예요.</p>
          )}
        </div>
      </div>
    </>
  );
}

function period(b: Book, day: string): string {
  const from = b.start ? shortDay(b.start, day) : "기록 전";
  return `${from} → ${b.end ? shortDay(b.end, day) : "진행 중"}${b.days !== null ? ` · ${b.days}일` : ""}`;
}

async function BookView({ b, review, editing, back, day }: { b: Book; review?: Review; editing: boolean; back: string; day: string }) {
  const entryHref = (p: Page) => `/journal/books/entry?${new URLSearchParams({ b: b.key, e: p.id })}`;
  const first = b.pages.find((p) => p.side === "buy");
  return (
    <div className="panel book-page">
      <p className="phone-only"><Link href={back}>← 책장으로</Link></p>
      <div className="book-head">
        <h2>{b.name}</h2>
        <span className="muted">{b.ticker} · {b.market === "KR" ? "국내" : "미국"} · {b.end ? "끝난 일기장" : "진행 중"}</span>
        <Link className="book-stock" href={`/stock/${encodeURIComponent(b.ticker)}`}>뉴스·차트 보기</Link>
      </div>
      <div className="stats book-kpi">
        <div className="stat"><div className="stat-label">기간</div><div className="stat-value">{b.days === null ? "-" : `${b.days}일`}</div><div className="stat-sub">{period(b, day).split(" · ")[0]}</div></div>
        {b.end ? (
          <div className="stat"><div className="stat-label">실현 손익</div><div className={`stat-value ${signClass(b.realized ?? 0)}`}>{b.realized === null ? "-" : signed(b, b.realized)}</div><div className="stat-sub">{b.fees > 0 ? `수수료·세금 ${money(b, b.fees)} 뺀 값` : b.realized === null ? "기록 전에 산 주식이 있어 못 구해요" : "판 것 기준"}</div></div>
        ) : (
          <div className="stat"><div className="stat-label">지금 보유</div><div className="stat-value">{qty(b.held)}주</div><div className="stat-sub">{b.avgCost ? `평단 ${money(b, b.avgCost)}` : "평단 모름"}</div></div>
        )}
        <div className="stat"><div className="stat-label">{b.end ? "수익률" : "지금 수익률"}</div><div className={`stat-value ${signClass(b.returnPct ?? 0)}`}>{pct(b.returnPct)}</div><div className="stat-sub">{b.end ? "수수료 포함" : "키움 잔고 기준"}</div></div>
        <div className="stat"><div className="stat-label">사고판 횟수</div><div className="stat-value">매수 {b.buys} · 매도 {b.sells}</div><div className="stat-sub">최대 {qty(b.maxHeld)}주 보유</div></div>
      </div>
      {b.startedBefore && (
        <div className="callout">키움에서 받은 기록보다 먼저 산 주식이 들어 있어요. 워커가 더 옛날 체결을 조금씩 받아 오고 있어서, 찾으면 첫 매수부터 채워져요.</div>
      )}

      <div className="tl">
        {b.pages.length === 0 && <p className="muted">키움에서 받은 기록 안에는 이 종목 매매가 없어요.</p>}
        {b.pages.map((p) => (
          <Link key={p.id} href={entryHref(p)} className="tl-item">
            <span className={`tl-dot ${p.side === "buy" ? "buy" : "sell"}`} />
            <span className="tl-row">
              <b>{shortDay(p.day, day)}</b>
              <span className={p.side === "buy" ? "up" : "down"}>{p.label}</span>
              <span className="num">{qty(p.quantity)}주 · {money(b, p.price)}</span>
              {p.pnl !== null && <span className={`num ${signClass(p.pnl)}`}>{signed(b, p.pnl)}</span>}
              <span className="muted tl-held">남은 {qty(p.held)}주</span>
            </span>
            <span className={p.note ? "tl-memo" : "tl-memo muted"}>{p.note ?? "아직 일지를 안 적었어요 · 눌러서 적기"}</span>
          </Link>
        ))}
      </div>

      {b.end ? (
        review && !editing ? <ReviewView b={b} r={review} /> : <ReviewForm b={b} r={review} first={first} />
      ) : (
        <p className="muted">전부 팔고 나면 여기 마지막 장에 사후강평을 써요. 다시 사면 새 일기장이 시작돼요.</p>
      )}
    </div>
  );
}

const QUESTIONS = [
  { name: "thesis", title: "왜 샀나요?", ask: "처음 생각이 맞았나요?" },
  { name: "plan", title: "계획대로 샀나요?", ask: "계획과 다르게 한 게 있나요?" },
  { name: "exitTiming", title: "팔 때는요?", ask: "판 타이밍은 어땠나요?" },
  { name: "lesson", title: "다시 한다면?", ask: "한 줄 교훈" },
] as const;

function ReviewView({ b, r }: { b: Book; r: Review }) {
  const answers = [r.thesis, r.plan, r.exit_timing, r.lesson];
  return (
    <section className="review">
      <div className="review-head">
        <h3>마지막 장 · 사후강평</h3>
        {r.stars && <span className="star">{stars(r.stars)}</span>}
        {r.followed_rules !== null && <span className={r.followed_rules ? "chip gold" : "chip"}>{r.followed_rules ? "원칙 지킴" : "원칙 못 지킴"}</span>}
        <span className="muted">{r.updated} 작성</span>
        <Link className="review-edit" href={`/journal/books?${new URLSearchParams({ b: b.key, edit: "review" })}`}>고치기</Link>
      </div>
      {QUESTIONS.map((q, i) => answers[i] && (
        <div key={q.name}><div className="q">{q.ask}</div><div className="a">{answers[i]}</div></div>
      ))}
    </section>
  );
}

async function ReviewForm({ b, r, first }: { b: Book; r?: Review; first?: Page }) {
  const plans = await buyPlans(b.pages.filter((p) => p.side === "buy" && p.entryId).map((p) => p.entryId!));
  const plan = first?.entryId ? plans.get(first.entryId) : undefined;
  const list = (side: "buy" | "sell") => b.pages.filter((p) => p.side === side).map((p) => `${p.day.slice(5)} ${money(b, p.price)}에 ${qty(p.quantity)}주`).join(", ");
  const facts = [
    plan ? `첫 매수 일지: ${plan.reason}` : first ? "첫 매수 일지를 안 적었어요." : "키움 기록 안에 첫 매수가 없어요.",
    [plan && `계획: 손절 ${money(b, Number(plan.stop_price))} · 익절 ${money(b, Number(plan.target_price))}`, list("buy") && `실제 매수: ${list("buy")}`].filter(Boolean).join(" / "),
    list("sell") && `매도: ${list("sell")}${b.returnPct !== null ? ` · 수익률 ${pct(b.returnPct)}` : ""}`,
    "",
  ];
  const values = [r?.thesis, r?.plan, r?.exit_timing, r?.lesson];
  return (
    <form action={saveReview} className="review">
      <input type="hidden" name="bookKey" value={b.key} />
      <div className="review-head"><h3>마지막 장 · 사후강평</h3><span className="muted">기록을 보면서 질문 네 개에 답해 보세요</span></div>
      <div className="review-qs">
        {QUESTIONS.map((q, i) => (
          <div key={q.name} className="review-q">
            <div className="review-title">{i + 1}. {q.title}</div>
            {facts[i] && <div className="review-fact">기록: {facts[i]}</div>}
            <label>{q.ask}<textarea name={q.name} defaultValue={values[i] ?? ""} rows={2} /></label>
          </div>
        ))}
      </div>
      <div className="review-foot">
        <span className="stars" role="radiogroup" aria-label="점수">
          {[5, 4, 3, 2, 1].map((n) => (
            <label key={n} title={`${n}점`}><input type="radio" name="stars" value={n} defaultChecked={r?.stars === n} />★</label>
          ))}
        </span>
        <label className="pick"><input type="radio" name="followedRules" value="yes" defaultChecked={r?.followed_rules === true} /> 원칙 지킴</label>
        <label className="pick"><input type="radio" name="followedRules" value="no" defaultChecked={r?.followed_rules === false} /> 못 지킴</label>
        <button type="submit">강평 저장</button>
      </div>
    </form>
  );
}
