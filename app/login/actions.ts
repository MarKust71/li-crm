"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthConfig } from "@/lib/auth/config";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth/session";
import { isLocked, recordAttempt } from "@/lib/auth/throttle";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Adres powrotu tylko względny i wewnętrzny (blokuje "//host", "https://…" i pętlę na /login). */
function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(?!\/)[A-Za-z0-9\-._~%/?=&]{0,500}$/.test(s) && !s.startsWith("/login") && !s.startsWith("/api/") ? s : "/contacts";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  // Na Vercelu x-forwarded-for ustawia platforma (klient nie może go podrobić).
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

function back(error: string, next: string): never {
  redirect(`/login?error=${error}${next !== "/contacts" ? `&next=${encodeURIComponent(next)}` : ""}`);
}

export async function loginAction(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const config = getAuthConfig();
  if (!config) back("config", next);

  const ip = await clientIp();
  if (await isLocked(ip)) {
    await sleep(500);
    back("locked", next);
  }

  const password = formData.get("password");
  const ok =
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= MAX_PASSWORD_LENGTH &&
    (await verifyPassword(password, config!.passwordHash));
  await recordAttempt(ip, ok);

  if (!ok) {
    await sleep(600); // spowalnia zgadywanie
    back("invalid", next);
  }

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(config!.secret), sessionCookieOptions);
  redirect(next);
}

export async function logoutAction() {
  // usunięcie ciasteczka __Host- wymaga tych samych atrybutów (Secure, Path=/)
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  redirect("/login");
}
