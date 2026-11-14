import type { ReminderKind, ReminderStatus, SyncState } from "@prisma/client";
import { DONE_PREFIX, eventStartToDue, splitMarker } from "./calendar-parse";
import { addDays, warsawDateOf } from "./dates";

// Czysta logika synchronizacji przypomnień z Kalendarzem Google (bez bazy i sieci). Warstwa bazy: lib/calendar-sync.ts.

// ───────────────────────── bramka: "czy teraz synchronizować?" ─────────────────────────

export type GateInput = { intervalMinutes: number; lastRunAt: Date | null; manualRequestedAt: Date | null; now: Date };
export type GateResult = { run: boolean; reason: "off" | "manual" | "manual-only" | "interval" | "wait" };

/**
 * Ustawienie: N > 0 = co N minut, 0 = tylko ręcznie (przycisk), -1 = wyłączona.
 * Kliknięcie przycisku działa przy 0 i N > 0, ale nie przy wyłączonej synchronizacji.
 */
export function evaluateGate({ intervalMinutes, lastRunAt, manualRequestedAt, now }: GateInput): GateResult {
  if (intervalMinutes < 0) return { run: false, reason: "off" };
  if (manualRequestedAt && (!lastRunAt || manualRequestedAt > lastRunAt)) return { run: true, reason: "manual" };
  if (intervalMinutes === 0) return { run: false, reason: "manual-only" };
  if (!lastRunAt || now.getTime() - lastRunAt.getTime() >= intervalMinutes * 60_000) return { run: true, reason: "interval" };
  return { run: false, reason: "wait" };
}

// ───────────────────────── aplikacja → kalendarz ─────────────────────────

export const ID_MARKER = "li-crm:"; // znacznik w opisie wydarzenia: pozwala odzyskać powiązanie, gdy n8n padnie po utworzeniu wydarzenia

export function defaultCalendarTitle(kind: ReminderKind, contactName: string): string {
  return `dMb Li ${kind === "RECONNECT" ? "reconnect" : "reminder"}: ${contactName}`;
}

/** Tytuł w kalendarzu: znacznik "odbyte" wynika ze statusu, reszta (calendarTitle) jest niezależna od niego. */
export function buildSummary(calendarTitle: string, status: ReminderStatus): string {
  return `${status === "DONE" ? DONE_PREFIX : ""}${calendarTitle}`;
}

export function buildDescription(input: { reminderId: string; profileUrl: string; note: string | null; email: string | null; phone: string | null }): string {
  return [input.profileUrl, input.note, input.email, input.phone, `${ID_MARKER}${input.reminderId}`].filter(Boolean).join("\n\n");
}

export type EventTimes = { allDay: boolean; startDate: string; endDate: string; startDateTime: string; endDateTime: string };

/**
 * Terminy w obu postaciach, żeby workflow wybrał właściwą: całodniowe (data początku i KOŃCOWA, wyłączna, +1 dzień,
 * jak w Google) albo z godziną (30 minut). Daty kalendarzowe liczone w czasie warszawskim.
 */
export function eventTimes(dueAt: Date, allDay: boolean): EventTimes {
  const startDate = warsawDateOf(dueAt);
  return {
    allDay,
    startDate,
    endDate: addDays(startDate, 1),
    startDateTime: dueAt.toISOString(),
    endDateTime: new Date(dueAt.getTime() + 30 * 60_000).toISOString(),
  };
}

export type SyncOp = {
  reminderId: string;
  op: "create" | "update" | "delete";
  eventId: string | null;
  summary: string;
  /** Tylko przy create: opis istniejących wydarzeń nie jest nadpisywany. */
  description: string | null;
} & EventTimes;

export type ReminderForOp = {
  id: string;
  status: ReminderStatus;
  dueAt: Date;
  allDay: boolean;
  calendarTitle: string | null;
  googleEventId: string | null;
  note: string | null;
  kind: ReminderKind;
  contact: { name: string; profileUrl: string; email: string | null; phone: string | null };
};

/** Jaką operację wykonać w kalendarzu dla przypomnienia z oczekującą zmianą; null = nic do wysłania. */
export function planOp(r: ReminderForOp): SyncOp | null {
  const title = r.calendarTitle ?? defaultCalendarTitle(r.kind, r.contact.name);
  const base = { reminderId: r.id, summary: buildSummary(title, r.status), ...eventTimes(r.dueAt, r.allDay) };
  if (r.status === "CANCELED") {
    return r.googleEventId ? { ...base, op: "delete", eventId: r.googleEventId, description: null } : null;
  }
  if (!r.googleEventId) {
    return {
      ...base,
      op: "create",
      eventId: null,
      description: buildDescription({ reminderId: r.id, profileUrl: r.contact.profileUrl, note: r.note, email: r.contact.email, phone: r.contact.phone }),
    };
  }
  return { ...base, op: "update", eventId: r.googleEventId, description: null };
}

// ───────────────────────── kalendarz → aplikacja ─────────────────────────

export type CalendarEventLite = {
  id: string;
  status?: string | null; // "confirmed" | "cancelled" | "tentative"
  summary?: string | null;
  description?: string | null;
  start?: { date?: string; dateTime?: string };
  updated?: string | null;
};

export type ReminderForChange = {
  status: ReminderStatus;
  syncState: SyncState;
  calendarUpdatedAt: Date | null;
  dueAt: Date;
  allDay: boolean;
  calendarTitle: string | null;
};

export type ChangeDecision =
  | { action: "skip"; reason: "echo" | "app-has-pending" | "canceled-locally" | "invalid" | "no-change" }
  | { action: "cancel" }
  | { action: "update"; patch: { status?: ReminderStatus; dueAt?: Date; allDay?: boolean; calendarTitle?: string }; calendarUpdatedAt: Date | null };

/**
 * Co zrobić z przypomnieniem, gdy jego wydarzenie zmieniło się w kalendarzu.
 * Zasady: usunięte w kalendarzu → anulowane; własne echo (updated <= zapisanego) pomijamy; jeśli aplikacja ma
 * niewysłane zmiany, wygrywa aplikacja (zostaną wysłane, a kalendarz dostosuje się przy następnej synchronizacji).
 */
export function decideCalendarChange(r: ReminderForChange, e: CalendarEventLite): ChangeDecision {
  if (e.status === "cancelled") return r.status === "CANCELED" ? { action: "skip", reason: "no-change" } : { action: "cancel" };
  if (r.status === "CANCELED") return { action: "skip", reason: "canceled-locally" };
  const updated = e.updated ? new Date(e.updated) : null;
  if (updated && r.calendarUpdatedAt && updated <= r.calendarUpdatedAt) return { action: "skip", reason: "echo" };
  if (r.syncState !== "SYNCED") return { action: "skip", reason: "app-has-pending" };

  const due = eventStartToDue(e.start);
  if (!due || typeof e.summary !== "string") return { action: "skip", reason: "invalid" };
  const { done, title } = splitMarker(e.summary);
  const patch: { status?: ReminderStatus; dueAt?: Date; allDay?: boolean; calendarTitle?: string } = {};
  const wantStatus: ReminderStatus = done ? "DONE" : "OPEN";
  if (r.status !== wantStatus) patch.status = wantStatus;
  if (r.dueAt.getTime() !== due.dueAt.getTime()) patch.dueAt = due.dueAt;
  if (r.allDay !== due.allDay) patch.allDay = due.allDay;
  if (r.calendarTitle !== title) patch.calendarTitle = title;
  if (Object.keys(patch).length === 0) return { action: "skip", reason: "no-change" };
  return { action: "update", patch, calendarUpdatedAt: updated };
}
