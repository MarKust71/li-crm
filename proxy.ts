import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authMode, getAuthConfig } from "@/lib/auth/config";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Bramka logowania dla całej aplikacji (Next.js 16: proxy.ts zastępuje middleware).
// Uwaga z dokumentacji Next.js: proxy nie jest pełną autoryzacją, dlatego każda Server Action
// dodatkowo sprawdza sesję sama (lib/access.ts → requireAccess).
export async function proxy(request: NextRequest) {
  const mode = authMode();
  if (mode === "misconfigured") {
    return new NextResponse("Dostęp zablokowany: brak konfiguracji logowania (AUTH_SECRET, AUTH_PASSWORD_HASH).", { status: 503 });
  }
  if (mode === "open") return NextResponse.next();

  const config = getAuthConfig()!;
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = token ? await verifySessionToken(token, config.secret) : false;

  // endpointy logowania kluczem dostępu (kolejny etap) są publiczne: same weryfikują podpis
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();
  // endpointy n8n (synchronizacja, powiadomienia, przyjmowanie danych z rozszerzenia) sprawdzają klucz API (SYNC_API_KEY / INGEST_API_KEY) same
  if (pathname.startsWith("/api/sync/") || pathname.startsWith("/api/notify/") || pathname.startsWith("/api/ingest/")) return NextResponse.next();

  if (pathname === "/login") {
    // zalogowany użytkownik nie potrzebuje formularza
    if (authed && request.method === "GET") return NextResponse.redirect(new URL("/contacts", request.url));
    return NextResponse.next();
  }

  if (authed) return NextResponse.next();

  if (request.method === "GET" || request.method === "HEAD") {
    const url = new URL("/login", request.url);
    const next = `${pathname}${search}`;
    if (next.length <= 500 && next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  return new NextResponse("Wymagane logowanie.", { status: 401 });
}

export const config = {
  // wszystko poza zasobami statycznymi Next.js
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
