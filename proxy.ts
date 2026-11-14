import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// TYMCZASOWA bramka dostępu do czasu wdrożenia Auth.js (CLAUDE.md: jeden użytkownik).
// W produkcji działa "fail closed": bez BASIC_AUTH_USER i BASIC_AUTH_PASSWORD nic nie jest
// serwowane, bo baza zawiera dane osobowe. W dev (NODE_ENV !== "production") bramka jest wyłączona.

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !password) {
    return new NextResponse("Dostęp zablokowany: brak konfiguracji BASIC_AUTH_USER / BASIC_AUTH_PASSWORD.", {
      status: 503,
    });
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded);
      const idx = decoded.indexOf(":");
      if (idx >= 0 && safeEqual(decoded.slice(0, idx), user) && safeEqual(decoded.slice(idx + 1), password)) {
        return NextResponse.next();
      }
    } catch {
      // niepoprawny base64 → traktuj jak brak uwierzytelnienia
    }
  }
  return new NextResponse("Wymagane logowanie.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="li-crm", charset="UTF-8"' },
  });
}

export const config = {
  // wszystko poza zasobami statycznymi Next.js
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
