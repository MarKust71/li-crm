/**
 * Jednorazowo: przelicza Contact.stage wszystkich kontaktów wg bieżącego `computeStage` (lib/stage.ts). Potrzebne po zmianie
 * reguły "wycofanie zaproszenia cofa do Zebrany": kontakty z wycofanym zaproszeniem miały zapisany etap "Zaproszony".
 * Zmienia tylko pole `stage` tam, gdzie wynik się różni; zdarzeń, przypomnień ani archiwizacji nie rusza.
 *
 *   npx tsx --env-file=.env scripts/recompute-stages.ts          # na sucho: wypisuje zmiany
 *   npx tsx --env-file=.env scripts/recompute-stages.ts --apply  # wykonuje
 *
 * Baza docelowa = DATABASE_URL (host wypisywany na początku). Bezpieczne do powtórzenia.
 */
import { logActivity } from "../lib/activity-log";
import { prisma } from "../lib/prisma";
import { computeStage } from "../lib/stage";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);

  const contacts = await prisma.contact.findMany({
    select: { id: true, name: true, stage: true, events: { select: { type: true, occurredAt: true, createdAt: true } } },
  });
  const changes = contacts
    .map((c) => ({ id: c.id, name: c.name, from: c.stage, to: computeStage(c.events) }))
    .filter((c) => c.from !== c.to);

  const byTransition: Record<string, number> = {};
  for (const c of changes) byTransition[`${c.from} → ${c.to}`] = (byTransition[`${c.from} → ${c.to}`] ?? 0) + 1;
  console.log(`Kontaktów: ${contacts.length}, do zmiany etapu: ${changes.length} ${JSON.stringify(byTransition)}`);
  for (const c of changes.slice(0, 20)) console.log(`  ${c.name}: ${c.from} → ${c.to}`);
  if (changes.length > 20) console.log(`  … i ${changes.length - 20} więcej`);
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  await prisma.$transaction(async (tx) => {
    for (const c of changes) await tx.contact.update({ where: { id: c.id }, data: { stage: c.to } });
    if (changes.length) {
      await logActivity({ source: "SYSTEM", action: "contact.stages_recomputed", summary: `Przeliczono etapy kontaktów (skrypt): ${changes.length}`, details: byTransition }, tx);
    }
  });
  console.log(`Zmieniono: ${changes.length}`);
}

main().finally(() => prisma.$disconnect());
