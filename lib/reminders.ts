import type { Prisma, ReminderKind, ReminderSource } from "@prisma/client";
import { connection } from "next/server";
import { contactName, logActivity } from "./activity-log";
import { prisma } from "./prisma";
import { addDays, parseDateInput, todayWarsaw, warsawDateOf } from "./dates";

export const OVERDUE_PAGE_SIZE = 50;
/** LinkedIn nie pozwala ponownie zaprosić osoby wcześniej niż 3 tygodnie po wycofaniu zaproszenia. */
export const RECONNECT_DAYS = 21;
export const UPCOMING_DAYS = 7;

export type ReminderResult = { ok: true } | { ok: false; error: string };

const SELECT = {
  id: true,
  kind: true,
  dueAt: true,
  allDay: true,
  note: true,
  status: true,
  source: true,
  doneAt: true,
  contact: { select: { id: true, name: true, profileUrl: true } },
} satisfies Prisma.ReminderSelect;

export type ReminderRow = Prisma.ReminderGetPayload<{ select: typeof SELECT }>;

/** Granice dnia w czasie warszawskim: [start, tomorrow) to "dziś". */
function dayBounds() {
  const today = todayWarsaw();
  return {
    start: parseDateInput(today)!,
    tomorrow: parseDateInput(addDays(today, 1))!,
    upcomingEnd: parseDateInput(addDays(today, 1 + UPCOMING_DAYS))!,
  };
}

// ───────────────────────── odczyt ─────────────────────────

export async function listToday(overduePage: number) {
  // Liczy "dziś", więc najpierw jawnie oznacz jako zależne od żądania (jak countDue).
  await connection();
  const { start, tomorrow, upcomingEnd } = dayBounds();
  const open = { status: "OPEN" } as const;
  const overdueWhere: Prisma.ReminderWhereInput = { ...open, dueAt: { lt: start } };

  const overdueTotal = await prisma.reminder.count({ where: overdueWhere });
  const overduePages = Math.max(1, Math.ceil(overdueTotal / OVERDUE_PAGE_SIZE));
  const page = Math.min(Math.max(1, overduePage), overduePages);

  const [overdue, today, upcoming] = await Promise.all([
    prisma.reminder.findMany({
      where: overdueWhere,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * OVERDUE_PAGE_SIZE,
      take: OVERDUE_PAGE_SIZE,
      select: SELECT,
    }),
    prisma.reminder.findMany({ where: { ...open, dueAt: { gte: start, lt: tomorrow } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], select: SELECT }),
    prisma.reminder.findMany({ where: { ...open, dueAt: { gte: tomorrow, lt: upcomingEnd } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], select: SELECT }),
  ]);
  return { overdue, overdueTotal, overduePages, overduePage: page, today, upcoming };
}

/** Liczba przypomnień do zrobienia: zaległe + dzisiejsze (do znaczka w nawigacji). */
export async function countDue(): Promise<number> {
  // Liczy "dziś", więc musi być jawnie zależne od żądania (cacheComponents zabrania czasu w prerenderze).
  await connection();
  const { tomorrow } = dayBounds();
  return prisma.reminder.count({ where: { status: "OPEN", dueAt: { lt: tomorrow } } });
}

/** Przypomnienia kontaktu bez anulowanych: otwarte najpierw (najbliższe), potem odbyte (najnowsze). */
export async function listContactReminders(contactId: string): Promise<ReminderRow[]> {
  const rows = await prisma.reminder.findMany({ where: { contactId, status: { not: "CANCELED" } }, select: SELECT });
  return rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
    return a.status === "OPEN" ? a.dueAt.getTime() - b.dueAt.getTime() : b.dueAt.getTime() - a.dueAt.getTime();
  });
}

// ───────────────────────── zapis ─────────────────────────

export async function createReminder(input: {
  contactId: string;
  kind: ReminderKind;
  /** "YYYY-MM-DD" (przypomnienie całodniowe, czas warszawski) */
  dueDate: string;
  note: string | null;
  source: ReminderSource;
}): Promise<ReminderResult> {
  const dueAt = parseDateInput(input.dueDate);
  if (!dueAt) return { ok: false, error: "date" };
  const exists = await prisma.contact.findUnique({ where: { id: input.contactId }, select: { id: true, name: true } });
  if (!exists) return { ok: false, error: "notfound" };
  const created = await prisma.reminder.create({
    data: { contactId: input.contactId, kind: input.kind, dueAt, allDay: true, note: input.note, source: input.source, syncState: "PENDING", syncAttempts: 0, syncError: null },
  });
  await logActivity({
    source: "UI",
    action: "reminder.created",
    contactId: input.contactId,
    summary: `Nowe przypomnienie (${input.kind === "RECONNECT" ? "ponowne zaproszenie" : "przypomnienie"}) na ${input.dueDate}: ${exists.name}`,
    details: { reminderId: created.id, kind: input.kind, dueDate: input.dueDate },
  });
  return { ok: true };
}

/** Wpis do dziennika o zmianie przypomnienia (po udanej zmianie). */
async function logReminder(id: string, action: string, verb: string, extra?: Record<string, string>) {
  const r = await prisma.reminder.findUnique({ where: { id }, select: { contactId: true, kind: true } });
  if (!r) return;
  await logActivity({ source: "UI", action: `reminder.${action}`, contactId: r.contactId, summary: `${verb}: ${await contactName(r.contactId)}`, details: { reminderId: id, kind: r.kind, ...extra } });
}

export async function completeReminder(id: string): Promise<ReminderResult> {
  const r = await prisma.reminder.updateMany({ where: { id, status: "OPEN" }, data: { status: "DONE", doneAt: new Date(), syncState: "PENDING", syncAttempts: 0, syncError: null } });
  if (r.count === 1) await logReminder(id, "completed", "Przypomnienie wykonane");
  return r.count === 1 ? { ok: true } : { ok: false, error: "notfound" };
}

export async function reopenReminder(id: string): Promise<ReminderResult> {
  const r = await prisma.reminder.updateMany({ where: { id, status: "DONE" }, data: { status: "OPEN", doneAt: null, syncState: "PENDING", syncAttempts: 0, syncError: null } });
  if (r.count === 1) await logReminder(id, "reopened", "Przypomnienie otwarte ponownie");
  return r.count === 1 ? { ok: true } : { ok: false, error: "notfound" };
}

export async function rescheduleReminder(id: string, dueDate: string): Promise<ReminderResult> {
  const dueAt = parseDateInput(dueDate);
  if (!dueAt) return { ok: false, error: "date" };
  const r = await prisma.reminder.updateMany({ where: { id, status: "OPEN" }, data: { dueAt, allDay: true, syncState: "PENDING", syncAttempts: 0, syncError: null } });
  if (r.count === 1) await logReminder(id, "rescheduled", `Przypomnienie przesunięte na ${dueDate}`, { dueDate });
  return r.count === 1 ? { ok: true } : { ok: false, error: "notfound" };
}

/** Anulowanie zostawia wiersz w bazie (status CANCELED), żeby n8n mógł skasować wydarzenie w kalendarzu Google. */
export async function cancelReminder(id: string): Promise<ReminderResult> {
  const r = await prisma.reminder.updateMany({ where: { id, status: { not: "CANCELED" } }, data: { status: "CANCELED", syncState: "PENDING", syncAttempts: 0, syncError: null } });
  if (r.count === 1) await logReminder(id, "canceled", "Przypomnienie anulowane");
  return r.count === 1 ? { ok: true } : { ok: false, error: "notfound" };
}

// ───────────────────────── automaty przy zdarzeniach kontaktu ─────────────────────────

type Tx = Prisma.TransactionClient;

/**
 * Wywoływane z addContactEvent (w tej samej transakcji):
 *  - wycofanie zaproszenia → przypomnienie RECONNECT za 3 tygodnie (o ile kontakt nie ma już otwartego),
 *  - ponowne zaproszenie (INVITE_SENT) → zamyka otwarty RECONNECT jako odbyty.
 */
export async function applyEventAutomations(tx: Tx, contactId: string, type: string, occurredAt: Date) {
  if (type === "INVITE_WITHDRAWN") {
    const open = await tx.reminder.count({ where: { contactId, kind: "RECONNECT", status: "OPEN" } });
    if (open === 0) {
      const dueAt = parseDateInput(addDays(warsawDateOf(occurredAt), RECONNECT_DAYS));
      if (dueAt) {
        await tx.reminder.create({ data: { contactId, kind: "RECONNECT", dueAt, allDay: true, source: "AUTO", syncState: "PENDING", syncAttempts: 0, syncError: null } });
        await logActivity({ source: "SYSTEM", action: "reminder.auto_created", contactId, summary: `Automatyczne przypomnienie o ponownym zaproszeniu (${warsawDateOf(dueAt)}): ${await contactName(contactId, tx)}` }, tx);
      }
    }
  } else if (type === "INVITE_SENT") {
    await tx.reminder.updateMany({
      where: { contactId, kind: "RECONNECT", status: "OPEN" },
      data: { status: "DONE", doneAt: new Date(), syncState: "PENDING", syncAttempts: 0, syncError: null },
    });
  }
}
