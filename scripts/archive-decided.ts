/**
 * Jednorazowo: archiwizuje wstecznie kontakty, które mają zdarzenie „Decyzja: tak/nie", a nie są jeszcze zarchiwizowane
 * (powód „Decyzja podjęta", otwarte przypomnienia anulowane; ta sama reguła co w addEventTx).
 *
 *   npx tsx --env-file=.env scripts/archive-decided.ts          # na sucho: tylko liczy i wypisuje
 *   npx tsx --env-file=.env scripts/archive-decided.ts --apply  # wykonuje
 *
 * Baza docelowa = DATABASE_URL (host wypisywany na początku). Migracja z wartością DECISION_MADE musi już być zastosowana.
 * Bezpieczne do powtórzenia: kontakty już zarchiwizowane są pomijane.
 */
import { setArchivedTx } from "../lib/contact-events";
import { prisma } from "../lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);

  const contacts = await prisma.contact.findMany({
    where: { archived: false, events: { some: { type: { in: ["DECISION_YES", "DECISION_NO"] } } } },
    select: {
      id: true,
      name: true,
      events: { where: { type: { in: ["DECISION_YES", "DECISION_NO"] } }, orderBy: { occurredAt: "desc" }, take: 1, select: { type: true } },
      _count: { select: { reminders: { where: { status: "OPEN" } } } },
    },
  });
  const yes = contacts.filter((c) => c.events[0].type === "DECISION_YES").length;
  const reminders = contacts.reduce((n, c) => n + c._count.reminders, 0);
  console.log(`Do zarchiwizowania: ${contacts.length} (ostatnia decyzja: tak ${yes}, nie ${contacts.length - yes}); otwartych przypomnień do anulowania: ${reminders}`);
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  let done = 0;
  for (const c of contacts) {
    // w transakcji sprawdzamy stan jeszcze raz, żeby nie nadpisać archiwizacji zrobionej w międzyczasie
    await prisma.$transaction(async (tx) => {
      const now = await tx.contact.findUnique({ where: { id: c.id }, select: { archived: true } });
      if (now && !now.archived) {
        await setArchivedTx(tx, c.id, "DECISION_MADE", { cancelReminders: true, source: "SYNC", trigger: c.events[0].type });
        done++;
      }
    });
  }
  console.log(`Zarchiwizowano: ${done}`);
}

main().finally(() => prisma.$disconnect());
