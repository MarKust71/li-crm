import { SITE, link } from "./notify-core";

// Czysta logika przyjmowania danych z rozszerzenia (bez bazy). Warstwa bazy: lib/ingest.ts.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type ViewedAgo = {
  at: Date;
  /** zaokrąglenie LinkedIn („3d” = 3–4 dni): w tym oknie to samo wyświetlenie uznajemy za powtórkę */
  toleranceMs: number;
  /** false = nie rozpoznano tekstu, przyjęto chwilę zebrania */
  exact: boolean;
};

/** Tekst „Viewed 2h ago” (LinkedIn po angielsku) → moment wyświetlenia liczony od chwili zebrania danych. */
export function parseViewedAgo(text: string | null | undefined, scrapedAt: Date): ViewedAgo {
  const t = (text ?? "").toLowerCase();
  const m = /(\d+)\s*(mo|mos|months?|yrs?|y|w|wks?|weeks?|d|days?|h|hrs?|hours?|mins?|minutes?|m|secs?|s)\b/.exec(t);
  if (!m) {
    const yesterday = /yesterday/.test(t);
    return {
      at: new Date(scrapedAt.getTime() - (yesterday ? DAY : 0)),
      toleranceMs: yesterday ? 36 * HOUR : 2 * HOUR,
      exact: /just now|\bnow\b|moment/.test(t) || yesterday,
    };
  }
  const n = Math.min(Number(m[1]), 1000);
  const u = m[2];
  const [unitMs, toleranceMs] = u.startsWith("mo")
    ? [30 * DAY, 32 * DAY]
    : u.startsWith("y")
      ? [365 * DAY, 400 * DAY]
      : u.startsWith("w")
        ? [7 * DAY, 8 * DAY]
        : u.startsWith("d")
          ? [DAY, 36 * HOUR]
          : u.startsWith("h")
            ? [HOUR, 2 * HOUR]
            : u.startsWith("m")
              ? [MIN, 2 * HOUR]
              : [1000, 2 * HOUR];
  return { at: new Date(scrapedAt.getTime() - n * unitMs), toleranceMs, exact: true };
}

/** Moment zebrania z rozszerzenia (ISO), ale tylko rozsądny (nie z przyszłości, nie starszy niż 2 dni); inaczej chwila przyjęcia. */
export function resolveScrapedAt(raw: unknown, now: Date): Date {
  if (typeof raw === "string") {
    const d = new Date(raw);
    const t = d.getTime();
    if (Number.isFinite(t) && t <= now.getTime() + 5 * MIN && t >= now.getTime() - 2 * DAY) return d;
  }
  return now;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/g, "l")
    .toLowerCase();

/**
 * Rozszerzenie przy kartach bez własnego przycisku „Message” (2./3. stopień) potrafi wziąć imię z innej karty. Rozpoznajemy to po tym,
 * że żaden człon imienia (min. 3 litery) nie występuje w adresie profilu (`/in/<slug>`); takiego imienia nie zapisujemy.
 */
export function nameMatchesProfile(name: string, profileUrl: string): boolean {
  const slug = fold(decodeURIComponentSafe(profileUrl.split("/in/")[1] ?? ""));
  const tokens = fold(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  return tokens.length === 0 || tokens.some((t) => slug.includes(t));
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export type ViewerInput = { name: string; profileUrl: unknown; occupation: string | null; viewedAt: string | null };

export const MAX_VIEWERS = 200;

/** Walidacja ładunku z n8n: `{ source: "profile_viewers", scrapedAt?, results: [...] }`. */
export function parseViewersPayload(
  body: unknown,
): { ok: true; items: ViewerInput[]; invalid: number; scrapedAt: unknown } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body" };
  const b = body as Record<string, unknown>;
  if (b.source !== "profile_viewers") return { ok: false, error: "source" };
  if (!Array.isArray(b.results)) return { ok: false, error: "results" };
  if (b.results.length > MAX_VIEWERS) return { ok: false, error: "too-many" };
  const items: ViewerInput[] = [];
  let invalid = 0;
  for (const r of b.results) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
    const name = text(o?.name, 200);
    if (!o || !name) {
      invalid++;
      continue;
    }
    items.push({ name, profileUrl: o.profileUrl, occupation: text(o.occupation, 300), viewedAt: text(o.viewedAt, 100) });
  }
  return { ok: true, items, invalid, scrapedAt: b.scrapedAt };
}

export type IngestReport = {
  received: number;
  /** pozycje bez poprawnego imienia lub adresu profilu */
  skipped: number;
  created: { name: string; profileUrl: string }[];
  /** kontakty, którym uzupełniono puste „Zajęcie” */
  occupationFilled: number;
  viewsAdded: number;
  /** to samo wyświetlenie było już zapisane */
  duplicates: number;
  /** nowe osoby pominięte, bo imię z rozszerzenia nie pasuje do adresu profilu (zob. nameMatchesProfile) */
  unclearName: number;
  /** wśród oglądających były kontakty zarchiwizowane (zdarzenie zapisano, archiwum bez zmian) */
  archivedViewers: number;
};

export function reportText(r: IngestReport): string {
  const lines = ["👀 <b>li-crm: kto oglądał profil</b>", `Sprawdzono: ${r.received - r.skipped} z ${r.received}`];
  lines.push(`Nowe kontakty: ${r.created.length}`, `Nowe wyświetlenia: ${r.viewsAdded}${r.duplicates ? ` (już zapisane, pominięte: ${r.duplicates})` : ""}`);
  if (r.occupationFilled) lines.push(`Uzupełniono zajęcie: ${r.occupationFilled}`);
  if (r.archivedViewers) lines.push(`Zarchiwizowani wśród oglądających: ${r.archivedViewers}`);
  if (r.skipped) lines.push(`Pominięto (brak imienia lub adresu): ${r.skipped}`);
  if (r.unclearName) lines.push(`Pominięto (imię niezgodne z adresem profilu): ${r.unclearName}`);
  if (r.created.length) {
    lines.push("", "<b>Nowe</b>", ...r.created.slice(0, 10).map((c) => `• ${link(c.name, c.profileUrl)}`));
    if (r.created.length > 10) lines.push(`… i ${r.created.length - 10} więcej`);
  }
  lines.push("", link("Kontakty", `${SITE}/contacts`));
  return lines.join("\n").slice(0, 3900);
}

// ───────────── Strona profilu (content6.js, source "profile_page") ─────────────

export type ProfileInput = { name: string; profileUrl: unknown; location: string | null; occupation: string | null; openToWork: boolean };

/** Walidacja ładunku z n8n: `{ source: "profile_page", results: [{ name, profileUrl, location, occupation, openToWork? }] }`. Jeden profil na żądanie (bierzemy pierwszą pozycję). */
export function parseProfilePayload(body: unknown): { ok: true; item: ProfileInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body" };
  const b = body as Record<string, unknown>;
  if (b.source !== "profile_page") return { ok: false, error: "source" };
  if (!Array.isArray(b.results) || b.results.length === 0) return { ok: false, error: "results" };
  const o = b.results[0] && typeof b.results[0] === "object" ? (b.results[0] as Record<string, unknown>) : null;
  const name = text(o?.name, 200);
  if (!o || !name) return { ok: false, error: "name" };
  // rozszerzenie dodaje pole tylko przy wykryciu statusu ("PRAWDA"); brak pola nie oznacza, że status zniknął
  const openToWork = o.openToWork === true || (typeof o.openToWork === "string" && /^(prawda|true)$/i.test(o.openToWork.trim()));
  return { ok: true, item: { name, profileUrl: o.profileUrl, location: text(o.location, 200), occupation: text(o.occupation, 300), openToWork } };
}

export type ProfileReport = {
  outcome: "created" | "updated" | "unchanged" | "skipped-url" | "skipped-name";
  name: string;
  profileUrl: string | null;
  /** nazwy pól uzupełnionych / zmienionych w istniejącym kontakcie (location, occupation, openToWork) */
  filled: string[];
  openToWork: boolean;
  archived: boolean;
};

const FIELD_PL: Record<string, string> = { location: "lokalizacja", occupation: "zajęcie", openToWork: "open to work" };

export function profileReportText(r: ProfileReport): string {
  const who = r.profileUrl ? link(r.name, r.profileUrl) : r.name;
  const lines = ["👤 <b>li-crm: dane profilu</b>"];
  if (r.outcome === "skipped-url") lines.push(`Pominięto: brak poprawnego adresu profilu (${r.name})`);
  else if (r.outcome === "skipped-name") lines.push(`Pominięto: imię niezgodne z adresem profilu`, who);
  else if (r.outcome === "created") lines.push(`Nowy kontakt: ${who}`);
  else if (r.outcome === "updated") lines.push(`Zaktualizowano: ${who}`, `Uzupełniono: ${r.filled.map((f) => FIELD_PL[f] ?? f).join(", ")}`);
  else lines.push(`Bez zmian: ${who}`);
  if (r.openToWork) lines.push("🟢 Open to work");
  if (r.archived) lines.push("Kontakt jest zarchiwizowany");
  lines.push("", link("Kontakty", `${SITE}/contacts`));
  return lines.join("\n").slice(0, 3900);
}
