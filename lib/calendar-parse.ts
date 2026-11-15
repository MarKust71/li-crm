import type { ReminderKind, ReminderStatus } from "@prisma/client";
import { warsawToUtc } from "./dates";

// Czyste funkcje do czytania wydarzeń z kalendarza Google "dMb" (bez dostępu do bazy). Używane przez import
// jednorazowy (scripts/import-calendar.ts) i bieżącą synchronizację (lib/calendar-sync.ts).

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Adres profilu z opisu: zwykły tekst, HTML (<a href>) albo przekierowanie google.com/url?q=… */
export function extractProfileUrl(description: string): string | null {
  const text = description
    .replace(/&amp;/g, "&")
    .replace(/https?:\/\/www\.google\.com\/url\?q=([^&"'<> ]+)[^"'<> ]*/gi, (_, u: string) => safeDecode(u));
  const m = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^\s"'<>)?&#/]+)/i.exec(text);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

const THREAD_RE = /https?:\/\/(?:www\.)?linkedin\.com\/messaging\/thread\/[^\s"'<>]+/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

export function extractThreadUrl(description: string): string | null {
  return THREAD_RE.exec(description.replace(/&amp;/g, "&"))?.[0] ?? null;
}

/**
 * Adres wątku z pola formularza: tylko https://www.linkedin.com/messaging/thread/<id>/ (bez parametrów i fragmentu; ogon z przekierowania Google "/&sa=D&…" z opisów wydarzeń też jest obcinany).
 * Zwraca: znormalizowany adres, "" dla pustego pola, null dla niepoprawnego.
 */
export function normalizeThreadUrl(input: string | null | undefined): string | "" | null {
  const t = (input ?? "").trim();
  if (!t) return "";
  const m = /^https?:\/\/(?:www\.)?linkedin\.com\/messaging\/thread\/([A-Za-z0-9_\-=%]+)\/?(?:[?#&].*)?$/i.exec(t);
  return m ? `https://www.linkedin.com/messaging/thread/${m[1]}/` : null;
}

function plainLines(description: string): string[] {
  return description
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function extractEmail(description: string): string | null {
  for (const line of plainLines(description)) {
    if (/https?:/.test(line)) continue;
    const m = EMAIL_RE.exec(line);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

/** Telefon: linia złożona z cyfr, spacji, +, - (co najmniej 9 cyfr), bez adresów. */
export function extractPhone(description: string): string | null {
  for (const line of plainLines(description)) {
    if (/https?:|@/.test(line)) continue;
    if (/^[+\d][\d\s-]{7,}$/.test(line) && line.replace(/\D/g, "").length >= 9) return line;
  }
  return null;
}

// Znacznik "odbyte" na początku tytułu: "v ", "x " albo "- " (konwencja użytkownika).
const MARKER_RE = /^\s*([vVxX-])\s+/;
export const DONE_PREFIX = "v ";

/** Rozdziela tytuł na znacznik "odbyte" i resztę (znormalizowane spacje). */
export function splitMarker(rawTitle: string): { done: boolean; title: string } {
  return { done: MARKER_RE.test(rawTitle), title: rawTitle.replace(MARKER_RE, "").replace(/\s+/g, " ").trim() };
}

export type ParsedTitle = {
  status: ReminderStatus;
  kind: ReminderKind;
  note: string | null;
  name: string | null;
  /** Ustawione dla wydarzeń, które nie są przypomnieniami (spotkania BP, follow-upy FU). */
  skipReason?: string;
};

export function parseTitle(rawTitle: string): ParsedTitle {
  const { done, title } = splitMarker(rawTitle);
  const status: ReminderStatus = done ? "DONE" : "OPEN";

  // spotkania (BOM) i follow-upy to nie przypomnienia (także z prefiksem niepewności: "? BP: …", "<> BP: …")
  if (/^(?:Mój\s+|[?<>\s]+)?BP\s*:/i.test(title)) return { status, kind: "REMINDER", note: null, name: null, skipReason: "spotkanie BP" };
  if (/^FU\s*:/i.test(title)) return { status, kind: "REMINDER", note: null, name: null, skipReason: "follow-up FU" };

  let m = /dMb Li (reminder|reconnect):\s*(.+)$/i.exec(title);
  if (m) return { status, kind: m[1].toLowerCase() === "reconnect" ? "RECONNECT" : "REMINDER", note: null, name: m[2].trim() };

  m = /^dMb Li\s*:\s*(.+)$/i.exec(title); // "dMb Li: Imię Nazwisko"
  if (m) return { status, kind: "REMINDER", note: null, name: m[1].trim() };

  m = /^(?:dMb Li|LI)\s+(.+?)\s*(?::|\s-\s)\s*(.+)$/.exec(title); // "dMb Li Imię Nazwisko: umówić BP"
  if (m) return { status, kind: "REMINDER", note: m[2].trim(), name: m[1].trim() };

  m = /^(?:dMb Li|LI)\s+(.+)$/.exec(title); // "dMb Li Imię Nazwisko" (bez czynności)
  if (m) return { status, kind: "REMINDER", note: null, name: m[1].trim() };

  // pozostałe tytuły ("Przypomnienie: …", "BP - decyzja: …", "dMb: ponowić umówienie terminu - Imię"): cały tytuł jako notatka
  const nameAfterDash = / - ([^-:]+)$/.exec(title)?.[1]?.trim() ?? null;
  return { status, kind: "REMINDER", note: title, name: nameAfterDash };
}

export function slugToName(url: string): string {
  const slug = url.split("/in/")[1] ?? url;
  return slug.replace(/-[0-9a-f]{6,}$/i, "").replace(/-/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Początek wydarzenia z Google: całodniowe ({date}) → północ czasu warszawskiego, z godziną ({dateTime}) → ta chwila. */
export function eventStartToDue(start: { date?: string; dateTime?: string } | undefined): { dueAt: Date; allDay: boolean } | null {
  if (start?.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start.date);
    return m ? { dueAt: warsawToUtc(+m[1], +m[2], +m[3]), allDay: true } : null;
  }
  if (start?.dateTime) {
    const d = new Date(start.dateTime);
    return Number.isNaN(d.getTime()) ? null : { dueAt: d, allDay: false };
  }
  return null;
}
