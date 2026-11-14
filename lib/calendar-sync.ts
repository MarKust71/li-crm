import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { extractProfileUrl, parseTitle, eventStartToDue, slugToName } from "./calendar-parse";
import { normalizeProfileUrl } from "./profile-url";
import { KEYS, getSyncSettings, setSetting } from "./settings";
import { ID_MARKER, decideCalendarChange, evaluateGate, planOp, type CalendarEventLite, type SyncOp } from "./calendar-sync-core";

export const CALENDAR_ID = "ibaah6jp13k0pjcc8nge6ahvmc@group.calendar.google.com"; // kalendarz "dMb"
export const MAX_ATTEMPTS = 5;
const BATCH = 50;

/** Bramka: czy workflow ma teraz synchronizować. Gdy tak, od razu "zajmuje" przebieg (lastRunAt), żeby nie uruchomić dwóch naraz. */
export async function claimRun(now = new Date()) {
  const s = await getSyncSettings();
  const gate = evaluateGate({ intervalMinutes: s.intervalMinutes, lastRunAt: s.lastRunAt, manualRequestedAt: s.manualRequestedAt, now });
  if (gate.run) await setSetting(KEYS.lastRunAt, now.toISOString());
  // kursor i kalendarz potrzebne workflow do pobrania zmian z kalendarza (updatedMin)
  return { ...gate, pullCursor: s.pullCursor?.toISOString() ?? null, calendarId: CALENDAR_ID };
}

export type PendingOp = SyncOp & { version: string };

export async function getPending(): Promise<{ ops: PendingOp[]; pullCursor: string | null; calendarId: string }> {
  const rows = await prisma.reminder.findMany({
    where: { OR: [{ syncState: "PENDING" }, { syncState: "ERROR", syncAttempts: { lt: MAX_ATTEMPTS } }] },
    orderBy: { updatedAt: "asc" },
    take: BATCH,
    include: { contact: { select: { name: true, profileUrl: true, email: true, phone: true } } },
  });
  const ops: PendingOp[] = [];
  const nothingToDo: string[] = [];
  for (const r of rows) {
    const op = planOp(r);
    if (op) ops.push({ ...op, version: r.updatedAt.toISOString() });
    else nothingToDo.push(r.id); // np. anulowane przypomnienie, które nigdy nie trafiło do kalendarza
  }
  if (nothingToDo.length) await prisma.reminder.updateMany({ where: { id: { in: nothingToDo }, syncState: { not: "SYNCED" } }, data: { syncState: "SYNCED", syncError: null } });
  const s = await getSyncSettings();
  return { ops, pullCursor: s.pullCursor?.toISOString() ?? null, calendarId: CALENDAR_ID };
}

export type OpResult = { reminderId: string; version: string; ok: boolean; eventId?: string | null; updated?: string | null; error?: string | null };

export async function applyResults(results: OpResult[]) {
  let synced = 0, failed = 0, stale = 0;
  for (const res of results) {
    const r = await prisma.reminder.findUnique({ where: { id: res.reminderId }, select: { id: true, updatedAt: true, googleEventId: true, syncAttempts: true } });
    if (!r) continue;
    if (!res.ok) {
      failed++;
      await prisma.reminder.update({ where: { id: r.id }, data: { syncState: "ERROR", syncAttempts: r.syncAttempts + 1, syncError: (res.error ?? "nieznany błąd").slice(0, 500) } });
      continue;
    }
    // zmiana w aplikacji po wygenerowaniu operacji → zapamiętaj powiązanie, ale zostaw PENDING (poleci kolejną operacją)
    const unchanged = r.updatedAt.toISOString() === res.version;
    const data: Prisma.ReminderUpdateInput = {
      googleEventId: res.eventId ?? r.googleEventId,
      googleCalendarId: res.eventId || r.googleEventId ? CALENDAR_ID : undefined,
      calendarUpdatedAt: res.updated ? new Date(res.updated) : undefined,
    };
    if (unchanged) Object.assign(data, { syncState: "SYNCED", syncError: null, syncAttempts: 0 });
    else stale++;
    await prisma.reminder.update({ where: { id: r.id }, data });
    if (unchanged) synced++;
  }
  return { synced, failed, stale };
}

export type PullSummary = { updated: number; canceled: number; linked: number; created: number; skipped: Record<string, number>; unmatched: string[] };

/** Zmiany z kalendarza (zdarzenia zmienione od kursora). `cursor` = moment rozpoczęcia pobierania po stronie n8n. */
export async function applyCalendarChanges(events: CalendarEventLite[], cursor: Date | null): Promise<PullSummary> {
  const sum: PullSummary = { updated: 0, canceled: 0, linked: 0, created: 0, skipped: {}, unmatched: [] };
  const skip = (k: string) => (sum.skipped[k] = (sum.skipped[k] ?? 0) + 1);

  for (const e of events) {
    if (!e.id) continue;
    let r = await prisma.reminder.findFirst({ where: { googleCalendarId: CALENDAR_ID, googleEventId: e.id } });

    // odzyskanie powiązania: wydarzenie utworzone przez aplikację, ale odpowiedź n8n zginęła
    if (!r && e.description) {
      const id = new RegExp(`${ID_MARKER}([a-z0-9]{20,32})`).exec(e.description)?.[1];
      if (id && e.status !== "cancelled") {
        const cand = await prisma.reminder.findUnique({ where: { id } });
        if (cand && !cand.googleEventId) {
          r = await prisma.reminder.update({ where: { id }, data: { googleEventId: e.id, googleCalendarId: CALENDAR_ID } });
          sum.linked++;
        }
      }
    }

    if (!r) {
      // nowe wydarzenie spoza aplikacji: tworzy przypomnienie tylko dla znanego kontaktu (po adresie profilu)
      if (e.status === "cancelled" || !e.description || typeof e.summary !== "string") { skip("nowe-pominięte"); continue; }
      const raw = extractProfileUrl(e.description);
      const profileUrl = raw ? normalizeProfileUrl(raw) : null;
      const due = eventStartToDue(e.start);
      const p = parseTitle(e.summary);
      if (!profileUrl || !due || p.skipReason) { skip(p.skipReason ?? "nowe-bez-profilu"); continue; }
      const contact = await prisma.contact.findUnique({ where: { profileUrl }, select: { id: true } });
      if (!contact) { sum.unmatched.push(slugToName(profileUrl)); skip("nieznany-kontakt"); continue; }
      const title = e.summary.replace(/^\s*[vVxX-]\s+/, "").replace(/\s+/g, " ").trim();
      await prisma.reminder.create({
        data: {
          contactId: contact.id, kind: p.kind, dueAt: due.dueAt, allDay: due.allDay, note: p.note, status: p.status,
          doneAt: p.status === "DONE" ? new Date() : null, source: "IMPORT", googleEventId: e.id, googleCalendarId: CALENDAR_ID,
          calendarTitle: title, syncState: "SYNCED", calendarUpdatedAt: e.updated ? new Date(e.updated) : null,
        },
      });
      sum.created++;
      continue;
    }

    const d = decideCalendarChange(r, e);
    if (d.action === "skip") { skip(d.reason); continue; }
    const updated = e.updated ? new Date(e.updated) : null;
    if (d.action === "cancel") {
      await prisma.reminder.update({ where: { id: r.id }, data: { status: "CANCELED", syncState: "SYNCED", syncError: null, calendarUpdatedAt: updated ?? undefined } });
      sum.canceled++;
    } else {
      const { patch } = d;
      await prisma.reminder.update({
        where: { id: r.id },
        data: {
          ...patch,
          ...(patch.status ? { doneAt: patch.status === "DONE" ? new Date() : null } : {}),
          syncState: "SYNCED", syncError: null, syncAttempts: 0, calendarUpdatedAt: d.calendarUpdatedAt ?? undefined,
        },
      });
      sum.updated++;
    }
  }
  if (cursor) await setSetting(KEYS.pullCursor, cursor.toISOString());
  await setSetting(KEYS.lastError, "");
  return sum;
}

export async function recordError(message: string) {
  await setSetting(KEYS.lastError, message.slice(0, 500));
}

export async function syncStatus() {
  const s = await getSyncSettings();
  const grouped = await prisma.reminder.groupBy({ by: ["syncState"], _count: true });
  return { settings: s, counts: Object.fromEntries(grouped.map((g) => [g.syncState, g._count])) as Record<string, number> };
}
