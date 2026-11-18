/**
 * Jednorazowo: scala tag 'viewers' (zakładka li-contact-data-store) z tagiem 'Viewers' (zakładka 1000-osob).
 * Kontaktom, które mają tylko 'viewers', dopisuje 'Viewers', potem usuwa tag 'viewers' (powiązania znikają kaskadowo).
 *
 *   npx tsx --env-file=.env scripts/merge-viewers-tag.ts          # na sucho
 *   npx tsx --env-file=.env scripts/merge-viewers-tag.ts --apply  # wykonuje
 *
 * Baza docelowa = DATABASE_URL (host wypisywany na początku). Bezpieczne do powtórzenia.
 */
import { logActivity } from "../lib/activity-log";
import { prisma } from "../lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);

  const lower = await prisma.tag.findUnique({ where: { name: "viewers" }, select: { id: true } });
  if (!lower) return console.log("Brak tagu 'viewers': nic do zrobienia.");
  const upper = await prisma.tag.findUnique({ where: { name: "Viewers" }, select: { id: true } });

  const links = await prisma.contactTag.findMany({ where: { tagId: lower.id }, select: { contactId: true } });
  const have = new Set(
    upper ? (await prisma.contactTag.findMany({ where: { tagId: upper.id }, select: { contactId: true } })).map((l) => l.contactId) : [],
  );
  const missing = links.map((l) => l.contactId).filter((id) => !have.has(id));
  console.log(`'viewers': ${links.length} kontaktów; 'Viewers': ${have.size}; do dopisania 'Viewers': ${missing.length}`);
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  await prisma.$transaction(async (tx) => {
    const target = upper ?? (await tx.tag.create({ data: { name: "Viewers" }, select: { id: true } }));
    if (missing.length) await tx.contactTag.createMany({ data: missing.map((contactId) => ({ contactId, tagId: target.id })), skipDuplicates: true });
    await tx.tag.delete({ where: { id: lower.id } });
  });
  await logActivity({ source: "SYSTEM", action: "tags.merge", summary: `Scalono tag 'viewers' z 'Viewers' (kontaktów: ${links.length}, dopisano 'Viewers': ${missing.length})`, details: { contacts: links.length, added: missing.length } });
  console.log("Gotowe.");
}

main().finally(() => prisma.$disconnect());
