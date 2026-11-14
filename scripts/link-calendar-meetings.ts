// Jednorazowe powiązanie istniejących wydarzeń "BP:" i "FU:" z kalendarza "dMb" (snapshot: scripts/snapshot-calendar.ts)
// ze spotkaniami w historii kontaktów.
//
//   npx tsx scripts/link-calendar-meetings.ts                  # DRY RUN: raport, bez zapisu
//   npx tsx scripts/link-calendar-meetings.ts --apply          # zapis (idempotentny)
//   npx tsx scripts/link-calendar-meetings.ts --apply --create-future   # dodatkowo: przyszłe spotkania bez wydarzenia → do kalendarza
//
// Zasady (ustalone z użytkownikiem): wiążemy tylko PEWNE dopasowania:
//  - BP: ten sam kontakt (nazwa bez względu na kolejność/polskie znaki) ORAZ ten sam termin (±1 min) co BOM_SCHEDULED,
//  - FU: jednoznaczny kontakt z odbytym BOM → nowe zdarzenie FOLLOW_UP (FU nie było w arkuszach, żyło tylko w kalendarzu).
// Reszta (inna godzina, brak kontaktu, okna dostępności "BP: 16, 18, 20", "Mój BP:", "? BP:") zostaje w raporcie i w kalendarzu bez zmian.
// Raport: data/reports/calendar-meetings-report.json (dane osobowe; data/ jest w .gitignore).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { eventStartToDue } from "../lib/calendar-parse";
import { addEventTx } from "../lib/contact-events";
import { parseDateInput, warsawDateOf } from "../lib/dates";
import { markerOutcome, meetingOutcome, nameKey, parseMeetingTitle } from "../lib/meeting-sync-core";

const APPLY = process.argv.includes("--apply");
const CREATE_FUTURE = process.argv.includes("--create-future");
const prisma = new PrismaClient();

type Ev = { id: string; summary: string | null; start: { date?: string; dateTime?: string }; end?: { dateTime?: string }; updated?: string };

async function main() {
  const snap = JSON.parse(readFileSync("data/snapshots/calendar/dMb.json", "utf8")) as { calendarId: string; events: Ev[] };
  const contacts = await prisma.contact.findMany({ select: { id: true, name: true } });
  const byName = new Map<string, string[]>();
  for (const c of contacts) byName.set(nameKey(c.name), [...(byName.get(nameKey(c.name)) ?? []), c.id]);
  const meetings = await prisma.contactEvent.findMany({ where: { type: "BOM_SCHEDULED", scheduledAt: { not: null } }, select: { id: true, contactId: true, scheduledAt: true, googleEventId: true } });
  const hist = await prisma.contactEvent.findMany({ where: { type: { in: ["BOM_SCHEDULED", "BOM_COMPLETED", "BOM_NO_SHOW", "BOM_CANCELED"] } }, select: { id: true, contactId: true, type: true, occurredAt: true, createdAt: true } });
  const completedContacts = new Set(hist.filter((h) => h.type === "BOM_COMPLETED").map((h) => h.contactId));
  const alreadyLinked = new Set((await prisma.contactEvent.findMany({ where: { googleEventId: { not: null } }, select: { googleEventId: true } })).map((x) => x.googleEventId!));

  const report = { linkedBom: [] as string[], nameOnly: [] as string[], noContact: [] as string[], skippedTitles: [] as string[], statusMismatch: [] as string[], fuCreated: [] as string[], fuSkipped: [] as string[], futureWithoutEvent: [] as string[] };
  const linkedMeetingIds = new Set<string>();

  for (const e of snap.events) {
    if (!e.summary || alreadyLinked.has(e.id)) continue;
    const label = `${e.summary} @${(e.start.dateTime ?? e.start.date ?? "").slice(0, 16)}`;
    const p = parseMeetingTitle(e.summary);
    if (!p) { if (/(^|\s)(BP|FU)\s*:/i.test(e.summary)) report.skippedTitles.push(label); continue; }
    const due = eventStartToDue(e.start);
    if (!due || due.allDay) { report.skippedTitles.push(label); continue; }
    const ids = byName.get(nameKey(p.name)) ?? [];
    const dur = e.end?.dateTime ? Math.round((new Date(e.end.dateTime).getTime() - due.dueAt.getTime()) / 60_000) : 30;
    const duration = dur >= 5 && dur <= 1440 ? dur : 30;
    const sync = { googleEventId: e.id, googleCalendarId: snap.calendarId, durationMinutes: duration, calendarUpdatedAt: e.updated ? new Date(e.updated) : null };

    if (p.type === "BOM_SCHEDULED") {
      const hit = meetings.find((m) => !m.googleEventId && !linkedMeetingIds.has(m.id) && ids.includes(m.contactId) && Math.abs(m.scheduledAt!.getTime() - due.dueAt.getTime()) < 60_000);
      if (hit) {
        linkedMeetingIds.add(hit.id);
        report.linkedBom.push(label);
        const want = markerOutcome(e.summary).outcome;
        const have = meetingOutcome(hit.id, hist.filter((h) => h.contactId === hit.contactId));
        if ((want === "completed" && have !== "completed") || (want === "no_show" && have !== "no_show") || (!want && have !== "open")) report.statusMismatch.push(`${label}: kalendarz=${want ?? "otwarte"}, aplikacja=${have}`);
        if (APPLY) await prisma.contactEvent.update({ where: { id: hit.id }, data: { ...sync, calendarTitle: markerOutcome(e.summary).title, syncState: "SYNCED" } });
      } else if (ids.length === 1) report.nameOnly.push(label);
      else report.noContact.push(label);
    } else {
      // FU: tylko jednoznaczny kontakt z odbytym BOM
      if (ids.length !== 1 || !completedContacts.has(ids[0])) { report.fuSkipped.push(`${label} (${ids.length === 1 ? "kontakt bez odbytego BOM" : ids.length ? "nazwa niejednoznaczna" : "brak kontaktu"})`); continue; }
      const dup = await prisma.contactEvent.findFirst({ where: { contactId: ids[0], type: "FOLLOW_UP", scheduledAt: due.dueAt } });
      if (dup) continue;
      report.fuCreated.push(label);
      if (APPLY) {
        await prisma.$transaction((tx) => addEventTx(tx, ids[0], {
          type: "FOLLOW_UP", occurredAt: parseDateInput(warsawDateOf(due.dueAt))!, scheduledAt: due.dueAt,
          sync: { ...sync, calendarTitle: e.summary!.replace(/\s+/g, " ").trim() },
        }, { fromCalendar: true }));
      }
    }
  }

  // spotkania z terminem w przyszłości, których nie ma w kalendarzu
  const now = new Date();
  for (const m of meetings) {
    if (m.googleEventId || linkedMeetingIds.has(m.id) || m.scheduledAt! <= now) continue;
    if (meetingOutcome(m.id, hist.filter((h) => h.contactId === m.contactId)) !== "open") continue;
    report.futureWithoutEvent.push(`${m.id} @${m.scheduledAt!.toISOString().slice(0, 16)}`);
    if (APPLY && CREATE_FUTURE) await prisma.contactEvent.update({ where: { id: m.id }, data: { syncState: "PENDING", syncAttempts: 0, syncError: null } });
  }

  mkdirSync("data/reports", { recursive: true });
  writeFileSync("data/reports/calendar-meetings-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    mode: APPLY ? (CREATE_FUTURE ? "APPLY+create-future" : "APPLY") : "DRY-RUN",
    bomLinked: report.linkedBom.length, bomNameOnly_toReview: report.nameOnly.length, bomNoContact: report.noContact.length,
    skippedTitles: report.skippedTitles.length, statusMismatch: report.statusMismatch.length,
    fuToCreate: report.fuCreated.length, fuSkipped: report.fuSkipped.length, futureMeetingsWithoutEvent: report.futureWithoutEvent.length,
  }));
}
main().finally(() => prisma.$disconnect());
