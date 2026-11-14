import { prisma } from "./prisma";
import { MAX_ATTEMPTS } from "./calendar-sync";
import { MEETING_TYPES, OUTCOME_TYPES, meetingOutcome } from "./meeting-sync-core";
import {
  dateLabelPl, digestDue, digestText, errorSignature, errorText, hhmm, meetingSoon, meetingSoonText, testText, warsawParts, type DigestMeeting,
} from "./notify-core";
import { getNotifySettings, getSyncSettings } from "./settings";
import { parseDateInput, addDays } from "./dates";

export type OutMessage = { key: string; kind: "digest" | "meeting" | "error" | "test"; text: string };

const RETAIN_DAYS = 60;

async function sentKeys(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  return new Set((await prisma.sentNotification.findMany({ where: { key: { in: keys } }, select: { key: true } })).map((k) => k.key));
}

/** Meetings open (not canceled/completed/no-show) among the given events, with person data. */
async function openMeetings(where: { scheduledAt: { gt?: Date; gte?: Date; lt?: Date; lte?: Date } }) {
  const meetings = await prisma.contactEvent.findMany({
    where: { type: { in: [...MEETING_TYPES] }, ...where },
    orderBy: { scheduledAt: "asc" },
    include: { contact: { select: { name: true, profileUrl: true } } },
  });
  if (!meetings.length) return [];
  const hist = await prisma.contactEvent.findMany({
    where: { contactId: { in: [...new Set(meetings.map((m) => m.contactId))] }, type: { in: ["BOM_SCHEDULED", ...OUTCOME_TYPES] } },
    select: { id: true, contactId: true, type: true, occurredAt: true, createdAt: true },
  });
  // FU nie ma stanu "odwołany"; BOM odwołany/odbyty/nieobecność nie jest już w planie
  return meetings.filter((m) => m.type === "FOLLOW_UP" || meetingOutcome(m.id, hist.filter((h) => h.contactId === m.contactId)) === "open");
}

/** Wiadomości, które mają wyjść teraz. Nic nie zapisuje: wysłane liczą się dopiero po potwierdzeniu (recordSent). */
export async function getDueMessages(now = new Date()): Promise<OutMessage[]> {
  const settings = await getNotifySettings();
  const { date: today } = warsawParts(now);
  const out: OutMessage[] = [];

  // 1) poranny przegląd
  const digestKey = `digest:${today}`;
  if (settings.digestHour >= 0 && digestDue({ digestHour: settings.digestHour, now, alreadySentToday: (await sentKeys([digestKey])).has(digestKey) })) {
    const start = parseDateInput(today)!;
    const tomorrow = parseDateInput(addDays(today, 1))!;
    const [reminders, overdueCount, meetings] = await Promise.all([
      prisma.reminder.findMany({
        where: { status: "OPEN", dueAt: { gte: start, lt: tomorrow } },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        include: { contact: { select: { name: true, profileUrl: true } } },
      }),
      prisma.reminder.count({ where: { status: "OPEN", dueAt: { lt: start } } }),
      // dzień warszawski: spotkania z terminem między północą a północą czasu warszawskiego
      openMeetings({ scheduledAt: { gte: start, lt: tomorrow } }),
    ]);
    const dm: DigestMeeting[] = meetings.map((m) => ({ type: m.type, name: m.contact.name, profileUrl: m.contact.profileUrl, time: hhmm(m.scheduledAt!) }));
    out.push({
      key: digestKey,
      kind: "digest",
      text: digestText({
        dateLabel: dateLabelPl(now),
        overdueCount,
        meetings: dm,
        reminders: reminders.map((r) => ({ name: r.contact.name, profileUrl: r.contact.profileUrl, kind: r.kind, note: r.note })),
      }),
    });
  }

  // 2) spotkanie za chwilę
  if (settings.meetingLeadMinutes > 0) {
    const soon = await openMeetings({ scheduledAt: { gt: now, lte: new Date(now.getTime() + settings.meetingLeadMinutes * 60_000) } });
    const cands = soon.filter((m) => meetingSoon(m.scheduledAt!, now, settings.meetingLeadMinutes)).map((m) => ({ m, key: `meeting:${m.id}:${m.scheduledAt!.getTime()}` }));
    const sent = await sentKeys(cands.map((c) => c.key));
    for (const { m, key } of cands) {
      if (sent.has(key)) continue;
      out.push({
        key,
        kind: "meeting",
        text: meetingSoonText({ type: m.type, name: m.contact.name, profileUrl: m.contact.profileUrl, time: hhmm(m.scheduledAt!), minutesLeft: (m.scheduledAt!.getTime() - now.getTime()) / 60_000 }),
      });
    }
  }

  // 3) błędy synchronizacji (ten sam zestaw: jedna wiadomość na dobę)
  if (settings.errorAlerts) {
    const failed = { syncState: "ERROR" as const, syncAttempts: { gte: MAX_ATTEMPTS } };
    const [rem, ev, stones, sync] = await Promise.all([
      prisma.reminder.findMany({ where: failed, select: { id: true, syncError: true } }),
      prisma.contactEvent.findMany({ where: failed, select: { id: true, syncError: true } }),
      prisma.calendarTombstone.findMany({ where: failed, select: { id: true, syncError: true } }),
      getSyncSettings(),
    ]);
    const all = [...rem, ...ev, ...stones];
    if (all.length > 0 || sync.lastError) {
      const key = `error:${errorSignature([...all.map((x) => x.id), sync.lastError ?? ""])}:${today}`;
      if (!(await sentKeys([key])).has(key)) {
        out.push({ key, kind: "error", text: errorText({ failed: all.length, samples: [...new Set(all.map((x) => x.syncError ?? "nieznany błąd"))], syncError: sync.lastError }) });
      }
    }
  }

  // 4) wiadomość testowa (przycisk w Ustawieniach)
  if (settings.testRequestedAt) {
    const key = `test:${settings.testRequestedAt.getTime()}`;
    if (!(await sentKeys([key])).has(key)) out.push({ key, kind: "test", text: testText() });
  }
  return out;
}

export async function recordSent(keys: string[]) {
  if (keys.length) await prisma.sentNotification.createMany({ data: keys.map((key) => ({ key })), skipDuplicates: true });
  await prisma.sentNotification.deleteMany({ where: { sentAt: { lt: new Date(Date.now() - RETAIN_DAYS * 86_400_000) } } });
}
