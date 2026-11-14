import { SignJWT, jwtVerify } from "jose";

export const SESSION_DAYS = 14;
const PROD = process.env.NODE_ENV === "production";

// Prefiks __Host- (tylko produkcja, wymaga Secure) wiąże ciasteczko z dokładnym hostem i blokuje jego nadpisanie z subdomeny.
export const SESSION_COOKIE = PROD ? "__Host-li_session" : "li_session";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: PROD,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

const key = (secret: string) => new TextEncoder().encode(secret);

/** Sesja jednego właściciela: bezstanowy token JWT (HS256). Unieważnienie wszystkich sesji = zmiana AUTH_SECRET. */
export async function createSessionToken(secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuer("li-crm")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key(secret));
}

export async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  try {
    await jwtVerify(token, key(secret), { issuer: "li-crm", subject: "owner", algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}
