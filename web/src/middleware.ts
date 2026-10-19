import { NextResponse, type NextRequest } from "next/server";

// PC 밖에서 접속할 때를 위한 기본 인증. 사용자 이름은 아무거나, 비밀번호는 APP_PASSWORD.
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("인증이 필요합니다", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="LODESTAR", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|manifest.webmanifest|icon|apple-icon|icon-192.png|icon-512.png).*)"] };
