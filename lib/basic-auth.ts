// TYMCZASOWA bramka dostępu do czasu wdrożenia Auth.js (CLAUDE.md: jeden użytkownik).
// W produkcji "fail closed": bez BASIC_AUTH_USER i BASIC_AUTH_PASSWORD nic nie jest dozwolone.
// W dev (NODE_ENV !== "production") bramka jest wyłączona.
export type AccessResult = "ok" | "denied" | "unconfigured";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkBasicAuth(authorization: string | null): AccessResult {
  if (process.env.NODE_ENV !== "production") return "ok";

  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !password) return "unconfigured";

  const [scheme, encoded] = (authorization ?? "").split(" ");
  if (scheme !== "Basic" || !encoded) return "denied";
  try {
    const decoded = atob(encoded);
    const idx = decoded.indexOf(":");
    if (idx >= 0 && safeEqual(decoded.slice(0, idx), user) && safeEqual(decoded.slice(idx + 1), password)) {
      return "ok";
    }
  } catch {
    // niepoprawny base64 → brak dostępu
  }
  return "denied";
}
