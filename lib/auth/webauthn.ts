import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

// Klucze dostępu (WebAuthn): konfiguracja domeny i jednorazowe wyzwania.
//
// Klucz jest przypięty do domeny (rpID): zarejestrowany na li-crm.mydmb.pl nie zadziała na innym adresie.
// Konfiguracja produkcyjna jest jawna (AUTH_RP_ID, AUTH_ORIGIN); bez niej klucze dostępu są wyłączone.

const PROD = process.env.NODE_ENV === "production";
export const WEBAUTHN_COOKIE = PROD ? "__Host-li_wa" : "li_wa";
const CHALLENGE_TTL_S = 300;
const MAX_OPEN_CHALLENGES = 200; // zabezpieczenie przed zalewaniem bazy z publicznego endpointu
export const MAX_PASSKEYS = 10;

export type RelyingParty = { rpID: string; origin: string; rpName: string };

export function getRelyingParty(request: Request): RelyingParty | null {
  const rpID = process.env.AUTH_RP_ID;
  const origin = process.env.AUTH_ORIGIN;
  if (rpID && origin) {
    try {
      const host = new URL(origin).hostname;
      // origin musi należeć do rpID (WebAuthn: rpID to domena lub jej nadrzędna)
      if (host === rpID || host.endsWith(`.${rpID}`)) return { rpID, origin: new URL(origin).origin, rpName: "li-crm" };
    } catch {
      /* niepoprawny AUTH_ORIGIN → wyłączone */
    }
    return null;
  }
  // Lokalny development bez konfiguracji: tylko localhost, origin z żądania.
  if (!PROD) {
    try {
      const o = request.headers.get("origin");
      const u = o ? new URL(o) : null;
      if (u && u.hostname === "localhost") return { rpID: "localhost", origin: u.origin, rpName: "li-crm (dev)" };
    } catch {
      /* ignoruj */
    }
  }
  return null;
}

/** Czy konfiguracja domeny istnieje (do ukrywania przycisków w UI; bez żądania nie znamy origin w dev). */
export function passkeysConfigured(): boolean {
  if (process.env.AUTH_RP_ID && process.env.AUTH_ORIGIN) return true;
  return !PROD;
}

/** Ochrona przed CSRF dla tras JSON: Origin musi być dokładnie naszym originem, a treść JSON-em. */
export function isSameOriginJson(request: Request, rp: RelyingParty): boolean {
  return request.headers.get("origin") === rp.origin && (request.headers.get("content-type") ?? "").includes("application/json");
}

export async function storeChallenge(purpose: "register" | "login", challenge: string): Promise<boolean> {
  await prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  if ((await prisma.authChallenge.count()) >= MAX_OPEN_CHALLENGES) return false;
  const row = await prisma.authChallenge.create({
    data: { challenge, purpose, expiresAt: new Date(Date.now() + CHALLENGE_TTL_S * 1000) },
  });
  (await cookies()).set(WEBAUTHN_COOKIE, row.id, { httpOnly: true, secure: PROD, sameSite: "lax", path: "/", maxAge: CHALLENGE_TTL_S });
  return true;
}

/** Zwraca wyzwanie i je usuwa (jednorazowe); null, gdy brak, wygasło lub ma inny cel. */
export async function consumeChallenge(purpose: "register" | "login"): Promise<string | null> {
  const jar = await cookies();
  const id = jar.get(WEBAUTHN_COOKIE)?.value;
  if (!id) return null;
  jar.set(WEBAUTHN_COOKIE, "", { httpOnly: true, secure: PROD, sameSite: "lax", path: "/", maxAge: 0 });
  const row = await prisma.authChallenge.findUnique({ where: { id } });
  if (!row || row.purpose !== purpose || row.expiresAt < new Date()) {
    if (row) await prisma.authChallenge.deleteMany({ where: { id } });
    return null;
  }
  // deleteMany zwraca liczbę usuniętych wierszy: przy dwóch równoległych próbach wygra tylko jedna
  const taken = await prisma.authChallenge.deleteMany({ where: { id } });
  return taken.count === 1 ? row.challenge : null;
}
