// Konfiguracja logowania pochodzi wyłącznie ze zmiennych środowiskowych (sekrety nie trafiają do repozytorium):
//   AUTH_SECRET         – klucz podpisu sesji, min. 32 znaki (np. `openssl rand -base64 48`)
//   AUTH_PASSWORD_HASH  – skrót hasła z `npx tsx scripts/hash-password.ts`
export type AuthConfig = { secret: string; passwordHash: string };

export function getAuthConfig(): AuthConfig | null {
  const secret = process.env.AUTH_SECRET;
  const passwordHash = process.env.AUTH_PASSWORD_HASH;
  if (!secret || secret.length < 32 || !passwordHash) return null;
  return { secret, passwordHash };
}

/**
 * enforce        – logowanie wymagane;
 * open           – tylko poza produkcją, gdy logowanie nie jest skonfigurowane (wygoda lokalnego developmentu);
 * misconfigured  – produkcja bez konfiguracji: "fail closed", nic nie jest serwowane (baza zawiera dane osobowe).
 */
export function authMode(): "enforce" | "open" | "misconfigured" {
  if (getAuthConfig()) return "enforce";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "open";
}
