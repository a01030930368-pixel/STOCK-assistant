from datetime import date, timedelta

from app import links


def series(start: date, values: list[float], skip_weekends=True):
    out, d = [], start
    for v in values:
        while skip_weekends and d.weekday() >= 5:
            d += timedelta(days=1)
        out.append((d, v))
        d += timedelta(days=1)
    return out


def test_follow_stats_counts_next_korean_day_after_big_us_moves():
    start = date(2026, 1, 5)  # 월요일
    # 미국: 매주 화요일 -6% 급락, 나머지는 그대로. 마지막 날(오늘 일)은 통계에서 빠져요.
    us_vals, kr_vals, p, k = [], [], 100.0, 1000.0
    for i in range(40):
        p = p * 0.94 if i % 5 == 1 else p * 1.0
        us_vals.append(p)
    us = series(start, us_vals)
    # 한국: 미국 급락 다음 날(수요일)마다 -3%, 단 한 번은 +1%
    for i in range(40):
        if i % 5 == 2:
            k = k * (1.01 if i == 7 else 0.97)
        kr_vals.append(k)
    kr = series(start, kr_vals)
    n, follow, avg = links.follow_stats(us, kr, -7.0, start)
    assert n == 8 and follow == 7
    assert round(avg, 2) == round((7 * -3 + 1) / 8, 2)
    assert links.follow_stats(us, kr, 7.0, start) is None  # 오른 날은 없어요
    assert links.follow_stats(us[:1], kr, -7.0, start) is None


def test_pick_and_lines():
    a = links.Link("MU", "마이크론", -8.1, "000660", "SK하이닉스", 9, 7, -3.1)
    weak = links.Link("MU", "마이크론", -8.1, "005930", "삼성전자", 9, 5, -1.5)
    few = links.Link("NVDA", "엔비디아", -6.0, "042700", "한미반도체", 3, 3, -4.0)
    second = links.Link("NVDA", "엔비디아", -6.0, "000660", "SK하이닉스", 10, 9, -2.0)
    got = links.pick([weak, few, second, a])
    assert got == [a]  # 하이닉스엔 가장 강한 짝(비율×평균) 하나만, 약하거나 적은 건 빼요
    text = "\n".join(links.lines([a]))
    assert "오늘 볼 연결고리" in text and "마이크론 -8.1%" in text and "9번 중 7번" in text and "같이 내렸어요" in text
    assert links.lines([]) == []
