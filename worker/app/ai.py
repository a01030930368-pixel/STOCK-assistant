"""AI 한마디. 보유 종목마다 하루 한 번, 내 매매일지·가격·뉴스·실적을 AI에 보내 보유 관점의 짧은 코멘트를 받습니다.

GEMINI_API_KEY(구글 무료 키)가 있으면 Gemini를, 없고 ANTHROPIC_API_KEY(유료)가 있으면 Claude를 씁니다. 둘 다 없으면 아무것도 하지 않습니다. 매수·매도 지시가 아니라, 내가 세운 계획과 지금 상황을 비교해 주는 메모입니다.
"""
import json
import logging
import re
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
        timeout=60,
    )
    if res.status_code >= 400:
        # 키가 응답에 섞여 나올 일은 없지만, 오류 본문은 앞부분만 남깁니다.
        raise RuntimeError(f"Claude API 오류 {res.status_code}: {res.text[:120]}")
    return "".join(b.get("text", "") for b in res.json().get("content", []) if b.get("type") == "text")


def ask(prompt: str, key: str, model: str, http: httpx.Client) -> Comment:
    return parse(claude_text(SYSTEM, prompt, key, model, http))


# 고른 모델이 붐비거나(503) 한도에 걸리면(429) 다음 무료 모델로 넘어갑니다.
GEMINI_FALLBACKS = ("gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite")
RETRY_STATUS = {404, 429, 500, 503}


# Gemini는 생각(thinking)에 쓴 글자도 답 길이 한도에 셉니다. 짧은 답을 바라도 한도는 넉넉히 둬야 답이 비거나 잘리지 않아요.
GEMINI_MIN_TOKENS = 4096


def gemini_text(system: str, prompt: str, key: str, model: str, http: httpx.Client, max_tokens: int = 2048) -> str:
    errors = []
    config: dict = {"maxOutputTokens": max(max_tokens, GEMINI_MIN_TOKENS)}
    # JSON으로 답하라는 지시가 있는 곳에서만 JSON 형식을 강제합니다. "티커|문장" 같은 글로 답할 곳까지 막으면 답이 깨져요.
    if "JSON" in system:
        config["responseMimeType"] = "application/json"
    for m in dict.fromkeys((model, *GEMINI_FALLBACKS)):
        # 키는 주소가 아니라 헤더로 보내서 오류 메시지·로그에 남지 않게 합니다.
        res = http.post(
            f"{GEMINI_API}{m}:generateContent",
            headers={"x-goog-api-key": key, "content-type": "application/json"},
            json={
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": config,
            },
            timeout=60,
        )
        if res.status_code in RETRY_STATUS:
            errors.append(f"{m} {res.status_code}")
            continue
        if res.status_code >= 400:
            raise RuntimeError(f"Gemini API 오류 {res.status_code}: {res.text[:160]}")
        cands = res.json().get("candidates") or []
        parts = ((cands[0].get("content") or {}).get("parts") or []) if cands else []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if cands and cands[0].get("finishReason") == "MAX_TOKENS":
            log.warning("Gemini 답이 길이 한도에서 잘렸어요 (%s)", m)
        return text
    raise RuntimeError("Gemini가 붐벼 다음에 다시 시도합니다: " + ", ".join(errors))


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
