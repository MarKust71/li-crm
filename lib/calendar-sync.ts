import { logActivity } from "./activity-log";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { extractEmail, extractPhone, extractProfileUrl, eventStartToDue, parseTitle, slugToName } from "./calendar-parse";
import { addEventTx } from "./contact-events";
import { parseDateInput, todayWarsaw, warsawDateOf } from "./dates";
import { normalizeProfileUrl } from "./profile-url";
import { KEYS, getSyncSettings, setSetting } from "./settings";
import { ID_MARKER, decideCalendarChange, evaluateGate, planOp, type CalendarEventLite, type SyncOp } from "./calendar-sync-core";
import {
  DEFAULT_DURATION, MEETING_TYPES, OUTCOME_TYPES, decideMeetingChange, markerOutcome, meetingOutcome, nameKey, parseMeetingTitle, planMeetingOp,
} from "./meeting-sync-core";

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

const retryable = { OR: [{ syncState: "PENDING" as const }, { syncState: "ERROR" as const, syncAttempts: { lt: MAX_ATTEMPTS } }] };

export async function getPending(): Promise<{ ops: PendingOp[]; pullCursor: string | null; calendarId: string }> {
  const ops: PendingOp[] = [];

  // 1) przypomnienia
  const rows = await prisma.reminder.findMany({
    where: retryable,
    orderBy: { updatedAt: "asc" },
    take: BATCH,
    include: { contact: { select: { name: true, profileUrl: true, threadUrl: true, email: true, phone: true } } },
  });
  const nothingToDo: string[] = [];
  for (const r of rows) {
    const op = planOp(r);
    if (op) ops.push({ ...op, version: r.updatedAt.toISOString() });
    else nothingToDo.push(r.id); // np. anulowane przypomnienie, które nigdy nie trafiło do kalendarza
  }
  if (nothingToDo.length) await prisma.reminder.updateMany({ where: { id: { in: nothingToDo }, syncState: { not: "SYNCED" } }, data: { syncState: "SYNCED", syncError: null } });

  // 2) spotkania (BOM umówiony, FU): stan wynika z historii kontaktu
  const meetings = await prisma.contactEvent.findMany({
    where: { type: { in: [...MEETING_TYPES] }, scheduledAt: { not: null }, ...retryable },
    orderBy: { updatedAt: "asc" },
    take: BATCH,
    include: { contact: { select: { name: true, profileUrl: true, threadUrl: true, email: true, phone: true } } },
  });
  if (meetings.length) {
    const hist = await prisma.contactEvent.findMany({
      where: { contactId: { in: [...new Set(meetings.map((m) => m.contactId))] }, type: { in: ["BOM_SCHEDULED", ...OUTCOME_TYPES] } },
      select: { id: true, contactId: true, type: true, occurredAt: true, createdAt: true },
    });
    const idle: string[] = [];
    for (const m of meetings) {
      const op = planMeetingOp(m, meetingOutcome(m.id, hist.filter((h) => h.contactId === m.contactId)));
      if (op) ops.push({ ...op, version: m.updatedAt.toISOString() });
      else idle.push(m.id);
    }
    if (idle.length) await prisma.contactEvent.updateMany({ where: { id: { in: idle }, syncState: { not: "SYNCED" } }, data: { syncState: "SYNCED", syncError: null } });
  }

  // 3) "nagrobki": wydarzenia po usuniętych zdarzeniach historii
  const stones = await prisma.calendarTombstone.findMany({ where: retryable, orderBy: { createdAt: "asc" }, take: BATCH });
  for (const t of stones) {
    ops.push({
      refType: "tombstone", refId: t.id, op: "delete", eventId: t.googleEventId, summary: "", description: null,
      allDay: false, startDate: "", endDate: "", startDateTime: "", endDateTime: "", version: t.createdAt.toISOString(),
    });
  }

  const s = await getSyncSettings();
  return { ops, pullCursor: s.pullCursor?.toISOString() ?? null, calendarId: CALENDAR_ID };
}

export type OpResult = {
  refType?: "reminder" | "event" | "tombstone";
  refId?: string;
  /** Zgodność ze starszym workflow: odpowiada refType "reminder". */
  reminderId?: string;
  op?: "create" | "update" | "delete";
  version: string;
  ok: boolean;
  eventId?: string | null;
  updated?: string | null;
  error?: string | null;
};

export async function applyResults(results: OpResult[]) {
  const out = await applyResultsInner(results);
  // znacznik końca przebiegu (pasek synchronizacji przestaje pokazywać "trwa")
  await setSetting(KEYS.lastFinishedAt, new Date().toISOString());
  if (out.synced || out.failed) {
    await logActivity({
      source: "SYNC",
      level: out.failed ? "WARN" : "INFO",
      action: "sync.push",
      summary: `Wysłano do kalendarza: ${out.synced} OK${out.failed ? `, ${out.failed} z błędem` : ""}${out.stale ? `, ${out.stale} do ponowienia (zmienione w międzyczasie)` : ""}`,
      details: out,
    });
  }
  return out;
}

async function applyResultsInner(results: OpResult[]) {
  let synced = 0, failed = 0, stale = 0;
  for (const res of results) {
    const refType = res.refType ?? "reminder";
    const refId = res.refId ?? res.reminderId;
    if (!refId) continue;
    const error = (res.error ?? "nieznany błąd").slice(0, 500);

    if (refType === "tombstone") {
      const t = await prisma.calendarTombstone.findUnique({ where: { id: refId } });
      if (!t) continue;
      if (res.ok) { await prisma.calendarTombstone.delete({ where: { id: refId } }); synced++; }
      else { failed++; await prisma.calendarTombstone.update({ where: { id: refId }, data: { syncState: "ERROR", syncAttempts: t.syncAttempts + 1, syncError: error } }); }
      continue;
    }

    const model = refType === "event" ? prisma.contactEvent : prisma.reminder;
    // wspólna część: oba modele mają te same pola synchronizacji
    const r = await (model as typeof prisma.reminder).findUnique({ where: { id: refId }, select: { id: true, updatedAt: true, googleEventId: true, syncAttempts: true } });
    if (!r) continue;
    if (!res.ok) {
      failed++;
      await (model as typeof prisma.reminder).update({ where: { id: r.id }, data: { syncState: "ERROR", syncAttempts: r.syncAttempts + 1, syncError: error } });
      continue;
    }
    // zmiana w aplikacji po wygenerowaniu operacji → zapamiętaj powiązanie, ale zostaw PENDING (poleci kolejną operacją)
    const unchanged = r.updatedAt.toISOString() === res.version;
    const deletedEvent = refType === "event" && res.op === "delete"; // wydarzenia spotkań po usunięciu nie mają już powiązania
    const data: Prisma.ReminderUpdateInput = deletedEvent
      ? { googleEventId: null, googleCalendarId: null, calendarUpdatedAt: null }
      : {
          googleEventId: res.eventId ?? r.googleEventId,
          googleCalendarId: res.eventId || r.googleEventId ? CALENDAR_ID : undefined,
          calendarUpdatedAt: res.updated ? new Date(res.updated) : undefined,
        };
    if (unchanged) Object.assign(data, { syncState: "SYNCED", syncError: null, syncAttempts: 0 });
    else stale++;
    await (model as typeof prisma.reminder).update({ where: { id: r.id }, data });
    if (unchanged) synced++;
  }
  return { synced, failed, stale };
}

export type PullSummary = {
  updated: number; canceled: number; linked: number; created: number;
  outcomes: number; // dopisane zdarzenia BOM_COMPLETED / BOM_NO_SHOW / BOM_CANCELED
  skipped: Record<string, number>; unmatched: string[];
};

const MEETING_SELECT = { id: true, contactId: true, type: true, syncState: true, calendarUpdatedAt: true, scheduledAt: true, durationMinutes: true, calendarTitle: true } as const;

/** Data zdarzenia wyniku spotkania: dzień terminu, ale nie w przyszłości. */
const outcomeDate = (scheduledAt: Date | null) => {
  const now = new Date();
  const at = scheduledAt && scheduledAt < now ? scheduledAt : now;
  return parseDateInput(warsawDateOf(at))!;
};

function durationOf(e: CalendarEventLite, start: Date): number {
  const end = e.end?.dateTime ? new Date(e.end.dateTime) : null;
  const mins = end && !Number.isNaN(end.getTime()) ? Math.round((end.getTime() - start.getTime()) / 60_000) : DEFAULT_DURATION;
  return mins >= 5 && mins <= 1440 ? mins : DEFAULT_DURATION;
}

/** Zmiany z kalendarza (zdarzenia zmienione od kursora). `cursor` = moment rozpoczęcia pobierania po stronie n8n. */
export async function applyCalendarChanges(events: CalendarEventLite[], cursor: Date | null): Promise<PullSummary> {
  const sum = await applyCalendarChangesInner(events, cursor);
  const changed = sum.updated + sum.canceled + sum.linked + sum.created + sum.outcomes;
  if (changed > 0) {
    const parts = [
      sum.created && `${sum.created} nowych`,
      sum.updated && `${sum.updated} zmienionych`,
      sum.canceled && `${sum.canceled} anulowanych`,
      sum.linked && `${sum.linked} powiązanych`,
      sum.outcomes && `${sum.outcomes} wyników spotkań`,
    ].filter(Boolean);
    await logActivity({ source: "SYNC", action: "sync.pull", summary: `Zmiany z kalendarza: ${parts.join(", ")}`, details: { ...sum, unmatched: sum.unmatched.slice(0, 20) } });
  }
  return sum;
}

async function applyCalendarChangesInner(events: CalendarEventLite[], cursor: Date | null): Promise<PullSummary> {
  const sum: PullSummary = { updated: 0, canceled: 0, linked: 0, created: 0, outcomes: 0, skipped: {}, unmatched: [] };
  const skip = (k: string) => (sum.skipped[k] = (sum.skipped[k] ?? 0) + 1);
  let nameIndex: Map<string, string[]> | null = null;
  const contactsByName = async () => {
    if (!nameIndex) {
      nameIndex = new Map();
      for (const c of await prisma.contact.findMany({ select: { id: true, name: true } })) {
        const k = nameKey(c.name);
        nameIndex.set(k, [...(nameIndex.get(k) ?? []), c.id]);
      }
    }
    return nameIndex;
  };

  for (const e of events) {
    if (!e.id) continue;

    // ── istniejące powiązania ──
    const r = await prisma.reminder.findFirst({ where: { googleCalendarId: CALENDAR_ID, googleEventId: e.id } });
    if (r) { await applyReminderChange(r, e, sum, skip); continue; }
    const m = await prisma.contactEvent.findFirst({ where: { googleCalendarId: CALENDAR_ID, googleEventId: e.id }, select: MEETING_SELECT });
    if (m) { await applyMeetingChange(m, e, sum, skip); continue; }

    // ── odzyskanie powiązania: wydarzenie utworzone przez aplikację, ale odpowiedź n8n zginęła ──
    const markerId = e.status !== "cancelled" && e.description ? new RegExp(`${ID_MARKER}([a-z0-9]{20,32})`).exec(e.description)?.[1] : undefined;
    if (markerId) {
      const cand = await prisma.reminder.findUnique({ where: { id: markerId } });
      if (cand && !cand.googleEventId) {
        await prisma.reminder.update({ where: { id: markerId }, data: { googleEventId: e.id, googleCalendarId: CALENDAR_ID } });
        sum.linked++;
        continue;
      }
      const candEv = await prisma.contactEvent.findUnique({ where: { id: markerId }, select: { id: true, googleEventId: true } });
      if (candEv && !candEv.googleEventId) {
        await prisma.contactEvent.update({ where: { id: markerId }, data: { googleEventId: e.id, googleCalendarId: CALENDAR_ID } });
        sum.linked++;
        continue;
      }
    }

    // ── nowe wydarzenie spoza aplikacji ──
    if (e.status === "cancelled" || typeof e.summary !== "string") { skip("nowe-pominięte"); continue; }
    const meeting = parseMeetingTitle(e.summary);
    if (meeting) { await discoverMeeting(e, meeting, sum, skip, contactsByName); continue; }
    await discoverReminder(e, sum, skip);
  }
  if (cursor) await setSetting(KEYS.pullCursor, cursor.toISOString());
  await setSetting(KEYS.lastError, "");
  return sum;
}

async function applyReminderChange(r: NonNullable<Awaited<ReturnType<typeof prisma.reminder.findFirst>>>, e: CalendarEventLite, sum: PullSummary, skip: (k: string) => number) {
  const d = decideCalendarChange(r, e);
  if (d.action === "skip") { skip(d.reason); return; }
  const updated = e.updated ? new Date(e.updated) : null;
  if (d.action === "cancel") {
    await prisma.reminder.update({ where: { id: r.id }, data: { status: "CANCELED", syncState: "SYNCED", syncError: null, calendarUpdatedAt: updated ?? undefined } });
    sum.canceled++;
    return;
  }
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

async function applyMeetingChange(
  m: Prisma.ContactEventGetPayload<{ select: typeof MEETING_SELECT }>,
  e: CalendarEventLite,
  sum: PullSummary,
  skip: (k: string) => number,
) {
  const hist = await prisma.contactEvent.findMany({
    where: { contactId: m.contactId, type: { in: ["BOM_SCHEDULED", ...OUTCOME_TYPES] } },
    select: { id: true, type: true, occurredAt: true, createdAt: true },
  });
  const d = decideMeetingChange(m, meetingOutcome(m.id, hist), e);
  if (d.action === "skip") { skip(d.reason); return; }
  const updated = e.updated ? new Date(e.updated) : null;

  if (d.action === "cancel") {
    await prisma.$transaction(async (tx) => {
      if (m.type === "FOLLOW_UP") {
        await tx.contactEvent.delete({ where: { id: m.id } }); // FU istnieje tylko wraz z wydarzeniem
      } else {
        await tx.contactEvent.update({ where: { id: m.id }, data: { googleEventId: null, googleCalendarId: null, calendarUpdatedAt: null, syncState: "SYNCED", syncError: null } });
        await addEventTx(tx, m.contactId, { type: "BOM_CANCELED", occurredAt: outcomeDate(m.scheduledAt) }, { fromCalendar: true });
      }
    });
    sum.canceled++;
    if (m.type !== "FOLLOW_UP") sum.outcomes++;
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.contactEvent.update({
      where: { id: m.id },
      data: { ...d.patch, syncState: "SYNCED", syncError: null, syncAttempts: 0, calendarUpdatedAt: d.calendarUpdatedAt ?? updated ?? undefined },
    });
    if (d.addOutcome) await addEventTx(tx, m.contactId, { type: d.addOutcome, occurredAt: outcomeDate(d.patch.scheduledAt ?? m.scheduledAt) }, { fromCalendar: true });
  });
  sum.updated++;
  if (d.addOutcome) sum.outcomes++;
}

async function discoverMeeting(
  e: CalendarEventLite,
  p: NonNullable<ReturnType<typeof parseMeetingTitle>>,
  sum: PullSummary,
  skip: (k: string) => number,
  contactsByName: () => Promise<Map<string, string[]>>,
) {
  const due = eventStartToDue(e.start);
  if (!due || due.allDay) { skip("spotkanie-bez-godziny"); return; }

  // kontakt: po adresie profilu z opisu, w ostateczności po jednoznacznej nazwie
  let contactId: string | null = null;
  const raw = e.description ? extractProfileUrl(e.description) : null;
  const profileUrl = raw ? normalizeProfileUrl(raw) : null;
  if (profileUrl) contactId = (await prisma.contact.findUnique({ where: { profileUrl }, select: { id: true } }))?.id ?? null;
  if (!contactId) {
    const ids = (await contactsByName()).get(nameKey(p.name)) ?? [];
    if (ids.length === 1) contactId = ids[0];
    else if (ids.length > 1) { skip("nazwa-niejednoznaczna"); sum.unmatched.push(p.name); return; }
  }
  if (!contactId) { skip("nieznany-kontakt"); sum.unmatched.push(p.name); return; }

  const rawTitle = e.summary!.replace(/\s+/g, " ").trim();
  const title = p.type === "FOLLOW_UP" ? rawTitle : markerOutcome(e.summary!).title;
  const sync = { googleEventId: e.id, googleCalendarId: CALENDAR_ID, calendarTitle: title, durationMinutes: durationOf(e, due.dueAt), calendarUpdatedAt: e.updated ? new Date(e.updated) : null };

  // to samo spotkanie już jest w historii (bez powiązania): tylko połącz
  const existing = await prisma.contactEvent.findFirst({
    where: { contactId, type: p.type, googleEventId: null, scheduledAt: { gte: new Date(due.dueAt.getTime() - 60_000), lte: new Date(due.dueAt.getTime() + 60_000) } },
    select: { id: true },
  });
  if (existing) {
    await prisma.contactEvent.update({ where: { id: existing.id }, data: { ...sync, syncState: "SYNCED" } });
    sum.linked++;
    return;
  }

  const res = await prisma.$transaction(async (tx) => {
    const added = await addEventTx(tx, contactId!, { type: p.type, occurredAt: parseDateInput(todayWarsaw())!, scheduledAt: due.dueAt, sync }, { fromCalendar: true });
    if (added.ok && p.type === "BOM_SCHEDULED" && p.outcome) {
      await addEventTx(tx, contactId!, { type: p.outcome === "completed" ? "BOM_COMPLETED" : "BOM_NO_SHOW", occurredAt: outcomeDate(due.dueAt) }, { fromCalendar: true });
    }
    return added;
  });
  if (!res.ok) { skip(res.error === "no-bom" ? "fu-bez-bom" : "spotkanie-bez-terminu"); return; }
  sum.created++;
}

async function discoverReminder(e: CalendarEventLite, sum: PullSummary, skip: (k: string) => number) {
  if (!e.description) { skip("nowe-pominięte"); return; }
  const raw = extractProfileUrl(e.description);
  const profileUrl = raw ? normalizeProfileUrl(raw) : null;
  const due = eventStartToDue(e.start);
  const p = parseTitle(e.summary!);
  if (!profileUrl || !due || p.skipReason) { skip(p.skipReason ?? "nowe-bez-profilu"); return; }
  const contact = await prisma.contact.findUnique({ where: { profileUrl }, select: { id: true } });
  if (!contact) { sum.unmatched.push(slugToName(profileUrl)); skip("nieznany-kontakt"); return; }
  const title = e.summary!.replace(/^\s*[vVxX-]\s+/, "").replace(/\s+/g, " ").trim();
  await prisma.reminder.create({
    data: {
      contactId: contact.id, kind: p.kind, dueAt: due.dueAt, allDay: due.allDay, note: p.note, status: p.status,
      doneAt: p.status === "DONE" ? new Date() : null, source: "IMPORT", googleEventId: e.id, googleCalendarId: CALENDAR_ID,
      calendarTitle: title, syncState: "SYNCED", calendarUpdatedAt: e.updated ? new Date(e.updated) : null,
    },
  });
  sum.created++;
}

export async function recordError(message: string) {
  await setSetting(KEYS.lastError, message.slice(0, 500));
  await logActivity({ source: "SYNC", level: "ERROR", action: "sync.error", summary: `Błąd synchronizacji: ${message.slice(0, 300)}` });
}

export async function syncStatus() {
  const s = await getSyncSettings();
  const [rem, ev, stones] = await Promise.all([
    prisma.reminder.groupBy({ by: ["syncState"], _count: true }),
    prisma.contactEvent.groupBy({ by: ["syncState"], where: { type: { in: [...MEETING_TYPES] }, scheduledAt: { not: null } }, _count: true }),
    prisma.calendarTombstone.count(),
  ]);
  const counts: Record<string, number> = {};
  for (const g of [...rem, ...ev]) counts[g.syncState] = (counts[g.syncState] ?? 0) + g._count;
  counts.PENDING = (counts.PENDING ?? 0) + stones;
  return { settings: s, counts };
}

/**
 * Kolejka zmian do wysłania do kalendarza: `pending` = czeka lub ponawia (to, co zabierze najbliższa synchronizacja),
 * `stuck` = błąd po wyczerpaniu prób (nie jest już ponawiane, wymaga uwagi w Ustawieniach).
 */
export async function syncQueue() {
  const meeting = { type: { in: [...MEETING_TYPES] }, scheduledAt: { not: null } };
  const [r1, e1, t1, r2, e2, t2] = await Promise.all([
    prisma.reminder.count({ where: retryable }),
    prisma.contactEvent.count({ where: { ...meeting, ...retryable } }),
    prisma.calendarTombstone.count({ where: retryable }),
    prisma.reminder.count({ where: { syncState: "ERROR", syncAttempts: { gte: MAX_ATTEMPTS } } }),
    prisma.contactEvent.count({ where: { ...meeting, syncState: "ERROR", syncAttempts: { gte: MAX_ATTEMPTS } } }),
    prisma.calendarTombstone.count({ where: { syncState: "ERROR", syncAttempts: { gte: MAX_ATTEMPTS } } }),
  ]);
  return { pending: r1 + e1 + t1, stuck: r2 + e2 + t2 };
}
