import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/basic-auth";

// Tymczasowa bramka dostępu (patrz lib/basic-auth.ts) do czasu wdrożenia Auth.js.
export function proxy(request: NextRequest) {
  const access = checkBasicAuth(request.headers.get("authorization"));
  if (access === "ok") return NextResponse.next();
  if (access === "unconfigured") {
    return new NextResponse("Dostęp zablokowany: brak konfiguracji BASIC_AUTH_USER / BASIC_AUTH_PASSWORD.", {
      status: 503,
    });
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
