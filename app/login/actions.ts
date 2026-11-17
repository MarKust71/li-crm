"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/redirect";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth/session";
import { logActivity, logLoginFailure } from "@/lib/activity-log";
import { isLocked, recordAttempt } from "@/lib/auth/throttle";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function clientIp(): Promise<string> {
  const h = await headers();
  // Na Vercelu x-forwarded-for ustawia platforma (klient nie może go podrobić).
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

function back(error: string, next: string): never {
  redirect(`/login?error=${error}${next !== "/dashboard" ? `&next=${encodeURIComponent(next)}` : ""}`);
}

export async function loginAction(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const config = getAuthConfig();
  if (!config) back("config", next);

  const ip = await clientIp();
  if (await isLocked(ip)) {
    await logLoginFailure("password", "adres zablokowany po zbyt wielu próbach", ip);
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
    await logLoginFailure("password", "błędne hasło", ip);
    await sleep(600); // spowalnia zgadywanie
    back("invalid", next);
  }

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(config!.secret), sessionCookieOptions);
  await logActivity({ source: "AUTH", action: "auth.login", summary: "Zalogowano hasłem", details: { ip } });
  redirect(next);
}

export async function logoutAction() {
  await logActivity({ source: "AUTH", action: "auth.logout", summary: "Wylogowano" });
  // usunięcie ciasteczka __Host- wymaga tych samych atrybutów (Secure, Path=/)
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  redirect("/login");
}
