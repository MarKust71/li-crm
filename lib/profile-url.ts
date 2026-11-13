// Normalizacja profileUrl wg docs/spec.md 6.1. Zwraca null, gdy to nie jest profil /in/<slug>.
export function normalizeProfileUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const input = raw.trim();
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;

  // pathname bez query i fragmentu; zdekoduj znaki procentowe (spec 6.1.3)
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // zostaw zakodowane, jeśli sekwencja jest niepoprawna
  }
  const segments = path.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "in" || !segments[1]) return null;

  const slug = segments[1].normalize("NFC").toLowerCase();
  return `https://www.linkedin.com/in/${slug}`;
}
