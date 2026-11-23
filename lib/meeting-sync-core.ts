import type { EventType } from "@prisma/client";
import { eventStartToDue } from "./calendar-parse";
import { DONE_PREFIX } from "./calendar-parse";
import { buildDescription, crmContactUrl, type CalendarEventLite, type SyncOp } from "./calendar-sync-core";

// Czysta logika synchronizacji spotkań (BOM_SCHEDULED i FOLLOW_UP) z Kalendarzem Google. Warstwa bazy: lib/calendar-sync.ts.

export const MEETING_TYPES = ["BOM_SCHEDULED", "FOLLOW_UP"] as const satisfies readonly EventType[];
export const OUTCOME_TYPES = ["BOM_COMPLETED", "BOM_NO_SHOW", "BOM_CANCELED"] as const satisfies readonly EventType[];
export const NO_SHOW_PREFIX = "x ";
export const DEFAULT_DURATION = 30;

export type Outcome = "open" | "completed" | "no_show" | "canceled";
type Hist = { id: string; type: EventType; occurredAt: Date; createdAt: Date };

const key = (e: Hist) => [e.occurredAt.getTime(), e.createdAt.getTime(), e.id] as const;
const cmp = (a: Hist, b: Hist) => {
  const x = key(a), y = key(b);
  return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
};

/**
 * Stan spotkania BOM wynika z historii kontaktu. Wyniki (odbyty / nieobecność / odwołany) należą do ostatniego
 * umówienia, które je poprzedza (albo do pierwszego, gdy poprzedza je wszystko). W obrębie umówienia: jakikolwiek
 * odbyty = odbyty, w przeciwnym razie wygrywa najnowszy z nieobecności i odwołania.
 */
export function meetingOutcome(scheduledId: string, history: Hist[]): Outcome {
  const scheduled = history.filter((e) => e.type === "BOM_SCHEDULED").sort(cmp);
  const idx = scheduled.findIndex((e) => e.id === scheduledId);
  if (idx < 0) return "open";
  const mine = history.filter((e) => (OUTCOME_TYPES as readonly string[]).includes(e.type)).filter((o) => {
    let owner = 0;
    for (let i = 0; i < scheduled.length; i++) if (cmp(scheduled[i], o) <= 0) owner = i;
    return owner === idx;
  });
  if (mine.some((o) => o.type === "BOM_COMPLETED")) return "completed";
  const last = mine.sort(cmp).at(-1);
  if (!last) return "open";
  return last.type === "BOM_NO_SHOW" ? "no_show" : "canceled";
}

/** Nadchodzące, jeszcze aktywne spotkania kontaktu: umówiony BOM bez wyniku (odbyty / nieobecność / odwołany) i FU z terminem w przyszłości. */
export function upcomingMeetings(
  events: { id: string; type: EventType; occurredAt: Date; createdAt: Date; scheduledAt: Date | null }[],
  now: Date,
): { type: EventType; scheduledAt: Date }[] {
  return events
    .filter((e) => (e.type === "BOM_SCHEDULED" || e.type === "FOLLOW_UP") && e.scheduledAt && e.scheduledAt > now)
    .filter((e) => e.type !== "BOM_SCHEDULED" || meetingOutcome(e.id, events) === "open")
    .map((e) => ({ type: e.type, scheduledAt: e.scheduledAt! }))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

export const defaultMeetingTitle = (type: EventType, contactName: string) => `${type === "FOLLOW_UP" ? "FU" : "BOM"}: ${contactName}`;

/** Tytuł w kalendarzu. BOM: znacznik wynika ze stanu; FU: tytuł dosłownie (znacznik użytkownika jest częścią tytułu). */
export function meetingSummary(type: EventType, title: string, outcome: Outcome): string {
  if (type === "FOLLOW_UP") return title;
  return `${outcome === "completed" ? DONE_PREFIX : outcome === "no_show" ? NO_SHOW_PREFIX : ""}${title}`;
}

export type MeetingForOp = {
  id: string;
  type: EventType;
  scheduledAt: Date | null;
  durationMinutes: number;
  calendarTitle: string | null;
  googleEventId: string | null;
  message: string | null;
  contact: { id: string; name: string; profileUrl: string; threadUrl?: string | null; email: string | null; phone: string | null };
};

/** `location`: domyślny link do spotkania (ustawienie „Domyślny link BOM”); `appOrigin`: adres aplikacji do linku w opisie. */
export function planMeetingOp(m: MeetingForOp, outcome: Outcome, ctx: { location?: string | null; appOrigin?: string | null } = {}): SyncOp | null {
  if (!m.scheduledAt) return null;
  const canceled = m.type === "BOM_SCHEDULED" && outcome === "canceled";
  const title = m.calendarTitle ?? defaultMeetingTitle(m.type, m.contact.name);
  const start = m.scheduledAt;
  const end = new Date(start.getTime() + m.durationMinutes * 60_000);
  const base = {
    refType: "event" as const,
    refId: m.id,
    summary: meetingSummary(m.type, title, outcome),
    allDay: false,
    startDate: "",
    endDate: "",
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
  };
  if (canceled) return m.googleEventId ? { ...base, op: "delete", eventId: m.googleEventId, description: null } : null;
  const withDetails = {
    ...base,
    location: ctx.location ?? null,
    description: buildDescription({ reminderId: m.id, profileUrl: m.contact.profileUrl, threadUrl: m.contact.threadUrl, crmUrl: crmContactUrl(ctx.appOrigin, m.contact.id), note: m.message, email: m.contact.email, phone: m.contact.phone }),
  };
  if (!m.googleEventId) return { ...withDetails, op: "create", eventId: null };
  return { ...withDetails, op: "update", eventId: m.googleEventId };
}

// ───────────────────────── kalendarz → aplikacja ─────────────────────────

/** "v"/"V" = odbyty, "x"/"X" = nieobecność, "-" i brak = bez znacznika wyniku. */
export function markerOutcome(rawTitle: string): { outcome: "completed" | "no_show" | null; title: string; hasMarker: boolean } {
  const m = /^\s*([vVxX-])\s+/.exec(rawTitle);
  const title = rawTitle.replace(/^\s*[vVxX-]\s+/, "").replace(/\s+/g, " ").trim();
  const c = m?.[1]?.toLowerCase();
  return { outcome: c === "v" ? "completed" : c === "x" ? "no_show" : null, title, hasMarker: !!m };
}

export type MeetingRow = {
  type: EventType;
  syncState: "PENDING" | "SYNCED" | "ERROR";
  calendarUpdatedAt: Date | null;
  scheduledAt: Date | null;
  durationMinutes: number;
  calendarTitle: string | null;
};

export type MeetingDecision =
  | { action: "skip"; reason: "echo" | "app-has-pending" | "invalid" | "no-change" | "marker-ignored" }
  | { action: "cancel" } // BOM: dopisz BOM_CANCELED; FU: usuń zdarzenie FU
  | { action: "update"; patch: { scheduledAt?: Date; durationMinutes?: number; calendarTitle?: string }; addOutcome: "BOM_COMPLETED" | "BOM_NO_SHOW" | null; calendarUpdatedAt: Date | null };

export function decideMeetingChange(m: MeetingRow, outcome: Outcome, e: CalendarEventLite): MeetingDecision {
  if (e.status === "cancelled") {
    if (m.type === "BOM_SCHEDULED" && outcome === "canceled") return { action: "skip", reason: "no-change" };
    return { action: "cancel" };
  }
  const updated = e.updated ? new Date(e.updated) : null;
  if (updated && m.calendarUpdatedAt && updated <= m.calendarUpdatedAt) return { action: "skip", reason: "echo" };
  if (m.syncState !== "SYNCED") return { action: "skip", reason: "app-has-pending" };

  const due = eventStartToDue(e.start);
  if (!due || due.allDay || typeof e.summary !== "string") return { action: "skip", reason: "invalid" }; // spotkanie musi mieć godzinę
  const patch: { scheduledAt?: Date; durationMinutes?: number; calendarTitle?: string } = {};
  if (!m.scheduledAt || m.scheduledAt.getTime() !== due.dueAt.getTime()) patch.scheduledAt = due.dueAt;
  const end = e.end?.dateTime ? new Date(e.end.dateTime) : null;
  if (end && !Number.isNaN(end.getTime())) {
    const mins = Math.round((end.getTime() - due.dueAt.getTime()) / 60_000);
    if (mins >= 5 && mins <= 1440 && mins !== m.durationMinutes) patch.durationMinutes = mins;
  }

  let addOutcome: "BOM_COMPLETED" | "BOM_NO_SHOW" | null = null;
  if (m.type === "FOLLOW_UP") {
    const raw = e.summary.replace(/\s+/g, " ").trim();
    if (raw !== m.calendarTitle) patch.calendarTitle = raw; // FU: znacznik użytkownika zostaje częścią tytułu
  } else {
    const { outcome: want, title } = markerOutcome(e.summary);
    if (title !== m.calendarTitle) patch.calendarTitle = title;
    if (want && want !== outcome) {
      if (outcome === "open") addOutcome = want === "completed" ? "BOM_COMPLETED" : "BOM_NO_SHOW";
      else if (Object.keys(patch).length === 0) return { action: "skip", reason: "marker-ignored" }; // historii nie cofamy z kalendarza
    }
  }
  if (Object.keys(patch).length === 0 && !addOutcome) return { action: "skip", reason: "no-change" };
  return { action: "update", patch, addOutcome, calendarUpdatedAt: updated };
}

// ───────────────────────── nowe wydarzenia z kalendarza ─────────────────────────

const NORM = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
/** Klucz do porównania nazw niezależny od kolejności ("Kowalski, Jan" = "Jan Kowalski") i polskich znaków. */
export const nameKey = (s: string) => NORM(s).split(" ").filter(Boolean).sort().join(" ");

/** Tylko dokładne "BOM:", "BP:" i "FU:" (z opcjonalnym znacznikiem). "Mój BP:", "? BP:" itp. są pomijane jako niepewne. */
export function parseMeetingTitle(rawTitle: string): { type: "BOM_SCHEDULED" | "FOLLOW_UP"; name: string; outcome: "completed" | "no_show" | null } | null {
  const { outcome, title } = markerOutcome(rawTitle);
  const m = /^(BOM|BP|FU)\s*:\s*(.+)$/i.exec(title);
  if (!m) return null;
  const name = m[2].trim();
  if (!name || /^[\d,\s]+$/.test(name)) return null; // okna dostępności typu "BP: 16, 18, 20"
  return { type: m[1].toUpperCase() === "FU" ? "FOLLOW_UP" : "BOM_SCHEDULED", name, outcome };
}
