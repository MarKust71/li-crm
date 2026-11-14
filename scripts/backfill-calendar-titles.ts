// Uzupełnia calendarTitle i calendarUpdatedAt zaimportowanych przypomnień z snapshotu kalendarza (data/snapshots/calendar/dMb.json).
// Bez tego synchronizacja nie znałaby oryginalnych tytułów wydarzeń i przy zmianie statusu nadpisałaby je tytułem domyślnym.
//
//   npx tsx scripts/backfill-calendar-titles.ts           # DRY RUN
//   npx tsx scripts/backfill-calendar-titles.ts --apply   # zapis (tylko wiersze, które nie mają jeszcze calendarTitle)
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { splitMarker } from "../lib/calendar-parse";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
type Ev = { id: string; summary: string | null; updated?: string };

async function main() {
  const snap = JSON.parse(readFileSync("data/snapshots/calendar/dMb.json", "utf8")) as { calendarId: string; events: Ev[] };
  const byId = new Map(snap.events.map((e) => [e.id, e]));
  const rows = await prisma.reminder.findMany({ where: { googleCalendarId: snap.calendarId, calendarTitle: null, googleEventId: { not: null } }, select: { id: true, googleEventId: true } });
  let todo = 0, missing = 0;
  for (const r of rows) {
    const e = byId.get(r.googleEventId!);
    if (!e || typeof e.summary !== "string") { missing++; continue; }
    todo++;
    if (APPLY) await prisma.reminder.update({ where: { id: r.id }, data: { calendarTitle: splitMarker(e.summary).title, calendarUpdatedAt: e.updated ? new Date(e.updated) : undefined } });
  }
  console.log(JSON.stringify({ mode: APPLY ? "APPLY" : "DRY-RUN", withoutTitle: rows.length, toUpdate: todo, notInSnapshot: missing }));
}
main().finally(() => prisma.$disconnect());
