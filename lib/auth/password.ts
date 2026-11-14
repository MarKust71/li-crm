import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

// Skrót hasła: scrypt (wbudowany w Node, bez zależności). Format bez znaku "$", bo Next.js rozwija $ZMIENNE
// w plikach .env i po cichu zepsułby wartość:  scrypt.<N>.<r>.<p>.<sól base64url>.<skrót base64url>

const N = 65536; // koszt CPU/pamięci (64 MiB przy r=8); OWASP zaleca N >= 2^17 z r=8, ale 2^16 mieści się w 128 MiB pamięci funkcji
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC: to samo hasło w różnych zapisach znaków (np. polskie litery złożone/rozłożone) daje ten sam skrót
    scryptCb(password.normalize("NFKC"), salt, keylen, { N: n, r, p, maxmem: 256 * n * r }, (e, key) =>
      e ? reject(e) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, N, R, P, KEYLEN);
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join(".");
}

/** Porównanie w stałym czasie; niepoprawny format skrótu daje false, nie wyjątek. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(".");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length < 8 || expected.length < 16) return false;
  try {
    const actual = await derive(password, salt, n, r, p, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
