"""실수 노트. 최근 6개월 매도 일지와 사후강평을 AI에 보내 자주 반복한 실수를 3개까지 뽑습니다.

AI는 실수 이름·설명과 그 실수가 보이는 기록 번호만 고르고, 횟수·평균 수익률·예시 종목은 여기서 기록으로 직접 셉니다.
숫자를 AI가 지어내지 않게 하려는 거예요.
"""
import json
import re
from dataclasses import dataclass, field
from datetime import date

MIN_ITEMS = 3  # 기록이 이보다 적으면 읽지 않아요
REASON = {"stop": "손절", "target": "익절", "other": "다른 사유"}

SYSTEM = """너는 개인 투자자의 매매 기록을 읽고, 이 사람이 자주 반복하는 실수를 찾아 주는 코치다.
규칙:
- 아래 기록(매도 일지 s번호, 사후강평 r번호)에 실제로 보이는 것만 쓴다. 추측하지 않는다.
- 실수는 최대 3개, 자주 보이는 순서로. 각 실수는 그 실수가 보이는 기록 번호를 ids에 모두 넣는다. 서로 다른 매매 2번 이상에서 보인 것만 넣는다("같은 매매"로 표시된 기록은 한 번으로 센다).
- title은 "손절을 미뤘어요"처럼 사용자가 한 행동을 12자 안팎의 해요체로.
- why는 그 실수가 어떻게 보이는지 한 문장. 숫자는 기록에 있는 것만 쓴다.
- good은 잘하고 있는 점 한 문장. 없으면 빈 문자열.
- summary는 2~3문장 해요체 정리. next는 "다음 매수부터" 해 볼 한 가지를 한 문장으로.
- phrases는 사용자가 기록에 여러 번 쓴 짧은 말(2~8자) 최대 4개, 기록에 쓴 그대로.
- "사세요/파세요" 같은 종목 지시는 하지 않는다.
- 반드시 JSON 하나로만 답한다:
{"mistakes": [{"title": "...", "why": "...", "ids": ["s1", "r2"]}], "good": "...", "summary": "...", "next": "...", "phrases": ["..."]}"""


@dataclass(frozen=True)
class Item:
    id: str  # s12(매도 일지 12번) 또는 r3(사후강평 3번째)
    kind: str  # sell | book
    ref: str  # 매도 일지 번호 또는 일기장 키
    name: str
    day: date
    ret: float | None
    text: str  # AI에게 보내는 한 줄
    words: str = field(default="", compare=False)  # 사용자가 직접 쓴 글(자주 쓴 말 세기용)
    trade: str = field(default="", compare=False)  # 같은 매매면 같은 값(일기장 키). 매도 일지와 사후강평이 한 매매를 두 번 세지 않게요


def _pct(v: float | None) -> str:
    return "모름" if v is None else f"{v:+.1f}%"


def sell_item(row) -> Item:
    """row: (id, 이름, 매도일, 수익률, 보유일, 사유, 사유 설명, 배운 것, 원칙 지킴, 판 가격, 손절가, 익절가[, 시장, 종목코드])"""
    sid, name, day, ret, held, reason, detail, lesson, followed, price, stop, target = row[:12]
    ret = None if ret is None else float(ret)
    parts = [f"매도 · {name} · {day.isoformat()} · 수익률 {_pct(ret)} · 보유 {held}일 · 사유 {REASON.get(reason, reason)}",
             f"원칙 지킴 {'예' if followed else '아니오'}"]
    if stop:
        gap = (float(price) / float(stop) - 1) * 100
        parts.append(f"손절가 {float(stop):,.2f} 대비 판 가격 {gap:+.1f}%")
    if target:
        parts.append(f"목표가 {float(target):,.2f} 대비 판 가격 {(float(price) / float(target) - 1) * 100:+.1f}%")
    if detail:
        parts.append(f"판 이유: {detail}")
    parts.append(f"배운 것: {lesson}")
    return Item(f"s{sid}", "sell", str(sid), name, day, ret, " · ".join(parts), f"{detail}\n{lesson}", f"s{sid}")


def review_item(n: int, key: str, name: str, end: date, ret: float | None, row) -> Item:
    """row: (별점, 원칙 지킴, 산 이유 돌아보기, 계획대로 했나, 판 타이밍, 교훈)"""
    stars, followed, thesis, plan, timing, lesson = row
    parts = [f"사후강평 · {name} · {end.isoformat()} 전량 매도 · 수익률 {_pct(ret)}"]
    if stars:
        parts.append(f"별점 {stars}/5")
    if followed is not None:
        parts.append(f"원칙 지킴 {'예' if followed else '아니오'}")
    for label, v in (("산 이유 돌아보기", thesis), ("계획대로 했나", plan), ("판 타이밍", timing), ("교훈", lesson)):
        if v:
            parts.append(f"{label}: {v}")
    return Item(f"r{n}", "book", key, name, end, ret, " · ".join(parts), "\n".join(v for v in (thesis, plan, timing, lesson) if v), key)


def build_prompt(items: list[Item]) -> str:
    """같은 매매의 매도 일지와 사후강평에는 서로 번호를 붙여, AI가 한 매매를 두 번 보고 '반복'이라 하지 않게 해요."""
    lines = [f"최근 기록 {len(items)}개 (같은 매매 표시가 있으면 한 번의 매매예요):"]
    for i in items:
        same = [o.id for o in items if o is not i and i.trade and o.trade == i.trade]
        lines.append(f"[{i.id}] {i.text}" + (f" · 같은 매매 {', '.join(same)}" if same else ""))
    return "\n".join(lines)


def parse(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"AI 응답에 JSON이 없습니다: {text[:60]}")
    return json.loads(m.group(0))


def _clip(v, n: int) -> str:
    return str(v or "").strip()[:n]


def assemble(raw: dict, items: list[Item]) -> dict:
    """AI가 고른 실수에 횟수·평균 수익률·예시를 기록에서 직접 셉니다. 기록에 없는 번호는 버려요."""
    by_id = {i.id: i for i in items}
    out = []
    for m in raw.get("mistakes") or []:
        found = [by_id[x] for x in dict.fromkeys(str(x).strip() for x in m.get("ids") or []) if x in by_id]
        # 한 매매에 매도 일지와 사후강평이 둘 다 있으면 한 번으로 세요. 수익률은 매매 전체를 본 사후강평 쪽을 써요.
        trades: dict[str, Item] = {}
        for h in sorted(found, key=lambda h: (h.kind != "book", h.ret is None)):
            trades.setdefault(h.trade or h.id, h)
        hits = list(trades.values())
        # 이름은 매도 일지 쪽이 더 깔끔해요(사후강평은 체결 내역의 영문 대문자 이름일 때가 있어요).
        names = {h.trade or h.id: h.name for h in sorted(found, key=lambda h: h.kind == "sell")}
        title = _clip(m.get("title"), 40)
        if len(hits) < 2 or not title:
            continue
        rets = [h.ret for h in hits if h.ret is not None]
        # 예시는 손해가 큰 순서로 3개까지. 이익만 있는 실수(이른 익절 같은 것)는 이익이 큰 순서로요.
        neg = any(r < 0 for r in rets)
        worst = sorted(hits, key=lambda h: (h.ret is None, 0 if h.ret is None else h.ret if neg else -h.ret))[:3]
        out.append({
            "title": title, "why": _clip(m.get("why"), 160), "count": len(hits),
            "avg": round(sum(rets) / len(rets), 1) if rets else None,
            "examples": [{"kind": h.kind, "ref": h.ref, "name": names[h.trade or h.id], "ret": h.ret} for h in worst],
        })
    out.sort(key=lambda m: -m["count"])
    words = "\n".join(i.words for i in items)
    phrases = []
    for p in raw.get("phrases") or []:
        p = _clip(p, 12)
        n = words.count(p) if p else 0
        if n >= 2 and p not in [x["text"] for x in phrases]:
            phrases.append({"text": p, "count": n})
    return {
        "mistakes": out[:3], "good": _clip(raw.get("good"), 160), "summary": _clip(raw.get("summary"), 500),
        "next": _clip(raw.get("next"), 200), "phrases": sorted(phrases, key=lambda x: -x["count"])[:4],
        "sells": sum(i.kind == "sell" for i in items), "reviews": sum(i.kind == "book" for i in items),
    }
