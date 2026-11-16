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
  /** wśród oglądających były kontakty zarchiwizowane (zdarzenie zapisano, archiwum bez zmian) */
  archivedViewers: number;
};

export function reportText(r: IngestReport): string {
  const lines = ["👀 <b>li-crm: kto oglądał profil</b>", `Sprawdzono: ${r.received - r.skipped} z ${r.received}`];
  lines.push(`Nowe kontakty: ${r.created.length}`, `Nowe wyświetlenia: ${r.viewsAdded}${r.duplicates ? ` (już zapisane, pominięte: ${r.duplicates})` : ""}`);
  if (r.occupationFilled) lines.push(`Uzupełniono zajęcie: ${r.occupationFilled}`);
  if (r.archivedViewers) lines.push(`Zarchiwizowani wśród oglądających: ${r.archivedViewers}`);
  if (r.skipped) lines.push(`Pominięto (brak imienia lub adresu): ${r.skipped}`);
  if (r.created.length) {
    lines.push("", "<b>Nowe</b>", ...r.created.slice(0, 10).map((c) => `• ${link(c.name, c.profileUrl)}`));
    if (r.created.length > 10) lines.push(`… i ${r.created.length - 10} więcej`);
  }
  lines.push("", link("Kontakty", `${SITE}/contacts`));
  return lines.join("\n").slice(0, 3900);
}
