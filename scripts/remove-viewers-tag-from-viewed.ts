/**
 * Jednorazowo: zdejmuje tag (domyślnie 'Viewers', inny: --tag="Nazwa") z kontaktów, które mają znacznik „Viewed” (zdarzenie VIEWED_MY_PROFILE).
 * Kontakty z tagiem, ale bez „Viewed”, zostają przy nim. Jeśli po operacji nikt nie ma tagu, tag jest usuwany.
 *
 *   npx tsx --env-file=.env scripts/remove-viewers-tag-from-viewed.ts          # na sucho
 *   npx tsx --env-file=.env scripts/remove-viewers-tag-from-viewed.ts --apply  # wykonuje
 *   npx tsx --env-file=.env scripts/remove-viewers-tag-from-viewed.ts --tag="Oglądali mnie" [--apply]
 *
 * Baza docelowa = DATABASE_URL (host wypisywany na początku). Bezpieczne do powtórzenia.
 */
import { logActivity } from "../lib/activity-log";
import { prisma } from "../lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const name = process.argv.find((a) => a.startsWith("--tag="))?.slice(6) || "Viewers";
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);

  const tag = await prisma.tag.findUnique({ where: { name }, select: { id: true } });
  if (!tag) return console.log(`Brak tagu '${name}': nic do zrobienia.`);

  const links = await prisma.contactTag.findMany({ where: { tagId: tag.id }, select: { contactId: true } });
  const ids = links.map((l) => l.contactId);
  const viewedRows = await prisma.contactEvent.findMany({
    where: { contactId: { in: ids }, type: "VIEWED_MY_PROFILE" },
    select: { contactId: true },
    distinct: ["contactId"],
  });
  const viewed = viewedRows.map((r) => r.contactId);
  const remaining = ids.length - viewed.length;
  console.log(`Tag '${name}': ${ids.length} kontaktów; z „Viewed”: ${viewed.length}; bez „Viewed” (zostają): ${remaining}`);
  console.log(remaining === 0 ? "Po operacji tag będzie pusty i zostanie usunięty." : "Tag zostaje (są kontakty bez „Viewed”).");
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  await prisma.$transaction(async (tx) => {
    await tx.contactTag.deleteMany({ where: { tagId: tag.id, contactId: { in: viewed } } });
    if (remaining === 0) await tx.tag.delete({ where: { id: tag.id } });
  });
  await logActivity({
    source: "SYSTEM",
    action: "tags.cleanup",
    summary: `Zdjęto tag '${name}' z kontaktów ze znacznikiem Viewed (kontaktów: ${viewed.length}, pozostało z tagiem: ${remaining})`,
    details: { removed: viewed.length, remaining, tagDeleted: remaining === 0 },
  });
  console.log("Gotowe.");
}

main().finally(() => prisma.$disconnect());
