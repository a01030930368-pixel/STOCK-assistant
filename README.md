# STOCK assistant

PC와 휴대폰에서 쓰는 개인 주식투자 보조 앱입니다. 키움증권 계좌를 **조회만** 하고, 주문 기능은 없습니다.

## 지금 되는 것 (MVP 1차)

- **포트폴리오**: 키움 국내 잔고(보유 종목, 평단, 현재가, 수익률)를 장중 1분마다 동기화
- **매매일지**
  - 매매원칙과 위기 대응 원칙이 매매일지 화면 상단에 항상 표시
  - 매수 기록: 매수 전 체크리스트 5개(한 문장 이유, 리스크 3개, 비중, 손절가, 익절가)를 다 채워야 저장
  - 매도 기록: 매도 이유, 배운 것, 원칙 준수 여부. 수익률과 보유 기간은 자동 계산
  - 종목별 자유 메모
- **알림**: 매수 기록을 저장하면 손절·익절 알림이 자동 생성되고, 가격에 도달하면 텔레그램으로
  "삼성전자(005930) 종목이 익절 목표가인 85,000에 도달했습니다" 메시지를 보냅니다.

아직 없는 것: 미국 주식 잔고 동기화, 매크로 환경 페이지, 종목 뉴스·재무, 차트 메모 (다음 단계).

## 구성

| 폴더 | 내용 |
| --- | --- |
| `web/` | Next.js 웹앱 (PC·휴대폰 화면, 홈 화면 설치 가능) |
| `worker/` | Python 워커 (키움 잔고 동기화, 알림 발송) |
| `db/schema.sql` | PostgreSQL 스키마 |
| `docker-compose.yml` | 위 셋을 PC에서 한 번에 실행 |

## PC에서 실행하기

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/)을 설치합니다.
2. `.env.example`을 `.env`로 복사하고 값을 채웁니다.
   - 키움 앱키·시크릿: [키움 REST API](https://openapi.kiwoom.com)에서 신청. 처음엔 `KIWOOM_MOCK=true`(모의투자)로 시작하세요.
   - 텔레그램: @BotFather로 봇을 만들어 토큰을 받고, 봇에게 말을 건 뒤
     `https://api.telegram.org/bot<토큰>/getUpdates`에서 `chat.id`를 확인합니다.
3. 실행합니다.

   ```bash
   docker compose up -d --build
   ```

4. 브라우저에서 http://localhost:3000 을 엽니다. 비밀번호는 `.env`의 `APP_PASSWORD`입니다.

휴대폰에서 밖에서 접속하려면 PC와 휴대폰에 [Tailscale](https://tailscale.com)을 설치하고 `http://<PC의 Tailscale 이름>:3000`으로 접속하세요.
PC가 꺼지거나 절전 모드에 들어가면 알림도 멈추니 절전 모드를 꺼 두세요.

## 개발

```bash
# 워커 테스트
cd worker && pip install -r requirements-dev.txt && python -m pytest

# 웹 테스트와 빌드
cd web && npm ci && npm test && npm run build
```

## 보안

키움 앱키는 주문까지 가능한 키입니다. `.env`는 git에 올라가지 않으며, 코드에는 주문 API를 아예 넣지 않았습니다.
