import { NextResponse, type NextRequest } from "next/server";

// 접속 비밀번호(기본 인증). 사용자 이름은 아무거나, 비밀번호는 .env의 APP_PASSWORD.
// 3000번 포트는 같은 와이파이의 다른 기기에서도 열리므로, 비밀번호가 비어 있거나 예시값이면 앱을 잠가 둡니다.
const WEAK = new Set(["", "change-me"]);

const SETUP_PAGE = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LODESTAR 잠김</title><body style="font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.7">
<h1>접속 비밀번호를 정해 주세요</h1>
<p>같은 와이파이의 누구나 들어올 수 없도록, 비밀번호가 비어 있거나 예시값(change-me)이면 앱을 잠가 둡니다.</p>
<ol>
<li>PC에서 LODESTAR 폴더를 열고, 위쪽 주소창에 <b>cmd</b>를 입력하고 엔터를 누르세요.</li>
<li>검은 창에 <code>notepad .env</code> 를 입력하고 엔터를 누르세요.</li>
<li><code>APP_PASSWORD=</code> 뒤에 나만 아는 비밀번호를 적고 저장(Ctrl+S)하세요. 예: <code>APP_PASSWORD=myStar2026</code></li>
<li>검은 창에 <code>docker compose up -d</code> 를 입력하고 엔터를 누르세요.</li>
<li>이 화면을 새로고침하면 비밀번호를 물어봐요. 사용자 이름은 아무거나 넣으면 돼요.</li>
</ol></body></html>`;

// 브라우저는 비밀번호를 UTF-8로 보내므로 한글 비밀번호도 맞게 풉니다.
function decode(encoded: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

export function middleware(req: NextRequest) {
  const password = (process.env.APP_PASSWORD ?? "").trim();
  if (WEAK.has(password)) {
    return new NextResponse(SETUP_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = decode(encoded);
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("인증이 필요합니다", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="LODESTAR", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|manifest.webmanifest|icon|apple-icon|icon-192.png|icon-512.png).*)"] };
