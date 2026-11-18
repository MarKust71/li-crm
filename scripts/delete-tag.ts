/**
 * Jednorazowo: usuwa tag o podanej nazwie razem z jego powiązaniami z kontaktami (kontakty zostają, tracą tylko ten tag).
 * Na sucho pokazuje, ilu kontaktów dotyczy i ilu zostanie bez żadnego tagu.
 *
 *   npx tsx --env-file=.env scripts/delete-tag.ts --tag="Nazwa"          # na sucho
 *   npx tsx --env-file=.env scripts/delete-tag.ts --tag="Nazwa" --apply  # wykonuje
 *
 * Baza docelowa = DATABASE_URL (host wypisywany na początku). Bezpieczne do powtórzenia.
 */
import { logActivity } from "../lib/activity-log";
import { prisma } from "../lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const name = process.argv.find((a) => a.startsWith("--tag="))?.slice(6);
  if (!name) throw new Error('Podaj --tag="Nazwa"');
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);

  const tag = await prisma.tag.findUnique({ where: { name }, select: { id: true } });
  if (!tag) return console.log(`Brak tagu '${name}': nic do zrobienia.`);

  const total = await prisma.contact.count({ where: { tags: { some: { tagId: tag.id } } } });
  const onlyThis = await prisma.contact.count({ where: { tags: { some: { tagId: tag.id }, every: { tagId: tag.id } } } });
  const archived = await prisma.contact.count({ where: { archived: true, tags: { some: { tagId: tag.id } } } });
  console.log(`Tag '${name}': ${total} kontaktów (w tym zarchiwizowanych: ${archived}); zostanie bez żadnego tagu: ${onlyThis}; z innymi tagami: ${total - onlyThis}`);
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  await prisma.tag.delete({ where: { id: tag.id } }); // ContactTag usuwa się kaskadowo
  await logActivity({
    source: "SYSTEM",
    action: "tags.cleanup",
    summary: `Usunięto tag '${name}' (kontaktów: ${total}, zostało bez tagu: ${onlyThis})`,
    details: { removed: total, withoutAnyTag: onlyThis, tagDeleted: true },
  });
  console.log("Gotowe.");
}

main().finally(() => prisma.$disconnect());
