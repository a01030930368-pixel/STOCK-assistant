"""AI 한마디. 보유 종목마다 하루 한 번, 내 매매일지·가격·뉴스·실적을 AI에 보내 보유 관점의 짧은 코멘트를 받습니다.

GEMINI_API_KEY(구글 무료 키)가 있으면 Gemini를, 없고 ANTHROPIC_API_KEY(유료)가 있으면 Claude를 씁니다. 둘 다 없으면 아무것도 하지 않습니다. 매수·매도 지시가 아니라, 내가 세운 계획과 지금 상황을 비교해 주는 메모입니다.
"""
import json
import logging
import re
import time
from dataclasses import dataclass

import httpx

log = logging.getLogger("worker")

API = "https://api.anthropic.com/v1/messages"
GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/"
DEFAULT_MODEL = "claude-haiku-5-5"
DEFAULT_GEMINI_MODEL = "gemini-flash-latest"
TONES = ("긍정", "중립", "주의")

SYSTEM = """너는 개인 투자자의 대시보드에 들어가는 '보유 관점 한마디'를 쓰는 조수다.
규칙:
- 사용자가 이미 들고 있는 종목을 계속 들고 갈지 점검하는 관점으로 쓴다.
- 사용자가 매매일지에 적은 매수 이유·시나리오·위험 요소·손절가·목표가와 지금 상황을 비교하는 것이 가장 중요하다.
- 주어진 자료에 있는 사실만 쓰고, 숫자는 자료에 있는 것만 쓴다. 모르는 것은 추측하지 않는다.
- 이번 주 금리 결정·경제지표 발표가 있고 이 종목에 영향이 클 만하면 한 번 짚어 준다. 없거나 관련이 적으면 말하지 않는다.
- "사세요/파세요" 같은 지시는 하지 않는다. 대신 무엇을 확인하면 좋을지 말한다.
- 한국어 존댓말, 2~3문장, 180자 이내.
- 반드시 JSON 한 줄로만 답한다: {"tone": "긍정|중립|주의", "comment": "..."}"""


@dataclass(frozen=True)
class Comment:
    tone: str
    body: str


def build_prompt(ctx: dict) -> str:
    """워커가 DB에서 모은 자료를 사람이 읽기 쉬운 메모 형태로 바꿉니다."""
    lines = [f"종목: {ctx['name']} ({ctx['ticker']}, {'국내' if ctx['market'] == 'KR' else '미국'})"]
    h = ctx.get("holding")
    if h:
        lines.append(f"보유: {h['quantity']}주, 평단 {h['avg_price']}, 현재가 {h['cur_price']}, 수익률 {h['pnl_pct']}%")
    j = ctx.get("journal")
    if j:
        lines.append(f"매수 이유: {j['reason']}")
        if j.get("scenario"):
            lines.append(f"시나리오: {j['scenario']}")
        lines.append(f"위험 요소: {', '.join(r for r in j['risks'] if r)}")
        lines.append(f"손절가 {j['stop_price']}, 목표가 {j['target_price']}")
    else:
        lines.append("매매일지 기록 없음(손절·목표가 없음)")
    p = ctx.get("price")
    if p:
        lines.append(
            "가격: " + ", ".join(f"{k} {v}" for k, v in p.items() if v is not None)
        )
    if ctx.get("earnings"):
        lines.append("최근 실적: " + " / ".join(ctx["earnings"]))
    if ctx.get("events"):
        lines.append("다가오는 일정: " + " / ".join(ctx["events"]))
    if ctx.get("macro"):
        lines.append("이번 주 시장 일정: " + " / ".join(ctx["macro"]))
    if ctx.get("news"):
        lines.append("최근 뉴스 제목:")
        lines.extend(f"- {n}" for n in ctx["news"])
    return "\n".join(lines)


def parse(text: str) -> Comment:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"AI 응답에 JSON이 없습니다: {text[:60]}")
    data = json.loads(m.group(0))
    body = str(data.get("comment", "")).strip()
    if not body:
        raise ValueError("AI 응답의 comment가 비어 있습니다")
    tone = data.get("tone") if data.get("tone") in TONES else "중립"
    return Comment(tone, body[:400])


def claude_text(system: str, prompt: str, key: str, model: str, http: httpx.Client, max_tokens: int = 400) -> str:
    res = http.post(
        API,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": prompt}]},
        timeout=wait_for(max_tokens),
    )
    if res.status_code >= 400:
        # 키가 응답에 섞여 나올 일은 없지만, 오류 본문은 앞부분만 남깁니다.
        raise RuntimeError(f"Claude API 오류 {res.status_code}: {res.text[:120]}")
    data = res.json()
    if data.get("stop_reason") == "max_tokens":
        raise Truncated(f"Claude 답이 길이 한도({max_tokens})에서 잘렸어요")
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


def ask(prompt: str, key: str, model: str, http: httpx.Client) -> Comment:
    return parse(claude_text(SYSTEM, prompt, key, model, http))


# 고른 모델이 붐비거나(503) 한도에 걸리면(429) 다음 무료 모델로 넘어갑니다.
# -latest 이름은 구글이 새 버전으로 알아서 바꿔 줘서 없어지지(404) 않아요. (gemini-2.5-* 는 없어져서 뺐어요.)
GEMINI_FALLBACKS = ("gemini-pro-latest", "gemini-flash-lite-latest")
RETRY_STATUS = {404, 429, 500, 503}
BUSY_STATUS = {429, 500, 503}
BUSY_WAIT = 8  # 붐빔(503) 답을 받으면 이만큼(초) 쉬고 같은 모델에 한 번 더 물어요


class AiBusy(RuntimeError):
    """모든 모델이 붐비거나(503·429) 너무 오래 걸렸어요. 조금 뒤 다시 하면 될 때가 많아요."""


class Truncated(RuntimeError):
    """답이 길이 한도에서 잘렸어요(생각에 쓴 글자도 한도에 셉니다). 잘린 글을 답으로 쓰지 않고, 부른 쪽이 다시 하거나 다른 길로 가요."""


class NoSearch(RuntimeError):
    """이 키로는 구글 검색을 쓸 수 없어요. 무료 Gemini 키에는 검색(Grounding with Google Search)이 없어서 늘 429가 와요."""


def _post_gemini(http: httpx.Client, model: str, key: str, body: dict, timeout: int) -> httpx.Response:
    url = f"{GEMINI_API}{model}:generateContent"
    # 키는 주소가 아니라 헤더로 보내서 오류 메시지·로그에 남지 않게 합니다.
    headers = {"x-goog-api-key": key, "content-type": "application/json"}
    res = http.post(url, headers=headers, json=body, timeout=timeout)
    if res.status_code in (500, 503):
        time.sleep(BUSY_WAIT)
        res = http.post(url, headers=headers, json=body, timeout=timeout)
    return res


def _gave_up(errors: list[tuple[str, int | None]]) -> RuntimeError:
    text = ", ".join(f"{m} {'시간 초과' if code is None else code}" for m, code in errors)
    busy = any(code is None or code in BUSY_STATUS for _, code in errors)
    return (AiBusy if busy else RuntimeError)("Gemini가 붐비거나 너무 오래 걸려 다음에 다시 시도합니다: " + text)


# 긴 답(기업 공부 노트 전체 등)은 1분 넘게 걸리기도 해요.
LONG = 2048


def wait_for(max_tokens: int) -> int:
    return 60 if max_tokens <= LONG else 240


# 다음에 써 볼 모델. 긴 답(기업 공부 노트)은 질이 떨어지는 lite 모델로 넘어가지 않아요.
def gemini_chain(model: str, max_tokens: int) -> tuple[str, ...]:
    chain = (model, *GEMINI_FALLBACKS)
    if max_tokens > LONG:
        chain = tuple(m for m in chain if "lite" not in m or m == model)
    return tuple(dict.fromkeys(chain))


# Gemini는 생각(thinking)에 쓴 글자도 답 길이 한도에 셉니다. 짧은 답을 바라도 한도는 넉넉히 둬야 답이 비거나 잘리지 않아요.
GEMINI_MIN_TOKENS = 4096


def gemini_text(system: str, prompt: str, key: str, model: str, http: httpx.Client, max_tokens: int = 2048) -> str:
    errors = []
    config: dict = {"maxOutputTokens": max(max_tokens, GEMINI_MIN_TOKENS)}
    # JSON으로 답하라는 지시가 있는 곳에서만 JSON 형식을 강제합니다. "티커|문장" 같은 글로 답할 곳까지 막으면 답이 깨져요.
    if "JSON" in system:
        config["responseMimeType"] = "application/json"
    for m in gemini_chain(model, max_tokens):
        # 너무 오래 걸리면(시간 초과) 다음 모델로 넘어가요.
        try:
            res = _post_gemini(http, m, key, {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": config,
            }, wait_for(max_tokens))
        except httpx.TimeoutException:
            errors.append((m, None))
            continue
        if res.status_code in RETRY_STATUS:
            errors.append((m, res.status_code))
            continue
        if res.status_code >= 400:
            raise RuntimeError(f"Gemini API 오류 {res.status_code}: {res.text[:160]}")
        cands = res.json().get("candidates") or []
        parts = ((cands[0].get("content") or {}).get("parts") or []) if cands else []
        if cands and cands[0].get("finishReason") == "MAX_TOKENS":
            raise Truncated(f"Gemini 답이 길이 한도({config['maxOutputTokens']})에서 잘렸어요 ({m})")
        return "".join(p.get("text", "") for p in parts if not p.get("thought"))
    raise _gave_up(errors)


def _gemini_search(system: str, prompt: str, key: str, model: str, http: httpx.Client, max_tokens: int) -> tuple[str, list[dict]]:
    # 구글 검색을 켜면 JSON 형식 강제를 같이 못 써요. 글에서 JSON을 찾아 읽습니다.
    errors = []
    for m in gemini_chain(model, max_tokens):
        try:
            res = _post_gemini(http, m, key, {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "tools": [{"google_search": {}}],
                "generationConfig": {"maxOutputTokens": max(max_tokens, GEMINI_MIN_TOKENS)},
            }, 300)
        except httpx.TimeoutException:
            errors.append((m, None))
            continue
        if res.status_code in RETRY_STATUS:
            errors.append((m, res.status_code))
            continue
        if res.status_code >= 400:
            raise RuntimeError(f"Gemini 검색 오류 {res.status_code}: {res.text[:160]}")
        cands = res.json().get("candidates") or []
        if not cands:
            return "", []
        if cands[0].get("finishReason") == "MAX_TOKENS":
            raise Truncated(f"Gemini 검색 답이 길이 한도에서 잘렸어요 ({m})")
        parts = (cands[0].get("content") or {}).get("parts") or []
        chunks = (cands[0].get("groundingMetadata") or {}).get("groundingChunks") or []
        sources = [{"title": (c.get("web") or {}).get("title", ""), "url": (c.get("web") or {}).get("uri", "")} for c in chunks if c.get("web")]
        return "".join(p.get("text", "") for p in parts if not p.get("thought")), sources
    # 모든 모델이 한도(429)나 없음(404)으로 거절하면 붐빈 게 아니라 이 키에 검색이 없는 거예요.
    if errors and all(code in (404, 429) for _, code in errors):
        raise NoSearch("무료 Gemini 키에는 구글 검색이 없어요 (" + ", ".join(f"{m} {code}" for m, code in errors) + ")")
    raise _gave_up(errors)


def _claude_search(system: str, prompt: str, key: str, model: str, http: httpx.Client, max_tokens: int) -> tuple[str, list[dict]]:
    res = http.post(
        API,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": prompt}],
              "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}]},
        timeout=180,
    )
    if res.status_code >= 400:
        raise RuntimeError(f"Claude 검색 오류 {res.status_code}: {res.text[:120]}")
    data = res.json()
    if data.get("stop_reason") == "max_tokens":
        raise Truncated(f"Claude 검색 답이 길이 한도({max_tokens})에서 잘렸어요")
    blocks = data.get("content", [])
    sources = [{"title": r.get("title", ""), "url": r.get("url", "")}
               for b in blocks if b.get("type") == "web_search_tool_result" and isinstance(b.get("content"), list) for r in b["content"]]
    # 검색 뒤에 쓴 마지막 글에 JSON이 있어요.
    texts = [b.get("text", "") for b in blocks if b.get("type") == "text"]
    return "".join(texts), sources


def search_asker(cfg):
    """웹 검색을 켜고 묻는 함수(system, prompt, key, model, http, max_tokens) -> (글, 출처 목록). 키가 없으면 None."""
    if cfg.gemini_api_key:
        return _gemini_search
    if cfg.anthropic_api_key:
        return _claude_search
    return None


def ask_gemini(prompt: str, key: str, model: str, http: httpx.Client) -> Comment:
    return parse(gemini_text(SYSTEM, prompt, key, model, http))


def text_asker(cfg):
    """(키, 모델, 함수(system, prompt, max_tokens) -> 글). 무료인 Gemini 키를 먼저 쓰고, 키가 없으면 (None, None, None)."""
    if cfg.gemini_api_key:
        key, model, fn = cfg.gemini_api_key, cfg.ai_model or DEFAULT_GEMINI_MODEL, gemini_text
    elif cfg.anthropic_api_key:
        key, model, fn = cfg.anthropic_api_key, cfg.ai_model or DEFAULT_MODEL, claude_text
    else:
        return None, None, None
    return key, model, fn
