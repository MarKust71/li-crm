/**
 * Jednorazowo: oznacza do ponownego wysłania do Kalendarza Google nadchodzące spotkania (BOM, FU) i otwarte przypomnienia, które już
 * mają wydarzenie, żeby dostały lokalizację („Domyślny link BOM"), link do karty kontaktu i aktualne dane kontaktu w opisie.
 * Wydarzenia przeszłe i zamknięte zostają bez zmian. Opis wydarzenia jest nadpisywany w całości.
 *
 *   npx tsx --env-file=.env scripts/refresh-calendar-events.ts          # na sucho: tylko liczy
 *   npx tsx --env-file=.env scripts/refresh-calendar-events.ts --apply  # wykonuje
 *
 * Baza docelowa = DATABASE_URL (host wypisywany na początku). Bezpieczne do powtórzenia. Wymaga wdrożonego kodu i zmienionego workflow n8n.
 */
import { MEETING_TYPES } from "../lib/meeting-sync-core";
import { logActivity } from "../lib/activity-log";
import { prisma } from "../lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);
  const now = new Date();
  const meetingWhere = { type: { in: [...MEETING_TYPES] }, scheduledAt: { gt: now }, googleEventId: { not: null } };
  const reminderWhere = { status: "OPEN" as const, googleEventId: { not: null } };
  const [meetings, reminders] = await Promise.all([prisma.contactEvent.count({ where: meetingWhere }), prisma.reminder.count({ where: reminderWhere })]);
  console.log(`Nadchodzące spotkania z wydarzeniem: ${meetings}; otwarte przypomnienia z wydarzeniem: ${reminders}`);
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  const data = { syncState: "PENDING" as const, syncAttempts: 0, syncError: null };
  await prisma.contactEvent.updateMany({ where: meetingWhere, data });
  await prisma.reminder.updateMany({ where: reminderWhere, data });
  await logActivity({ source: "SYNC", action: "sync.refresh_all", summary: `Oznaczono do aktualizacji w kalendarzu: ${meetings} spotkań, ${reminders} przypomnień`, details: { meetings, reminders } });
  console.log("Gotowe.");
}

main().finally(() => prisma.$disconnect());
