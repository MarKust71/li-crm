/**
 * Jednorazowo: dopisuje tagi wynikające z pola `contactFrom` (kolumna „Contact-From” z arkuszy), których import nie utworzył:
 *  - „PLC” → istniejący tag „Perfect Look Clinic”,
 *  - warianty bez stopnia połączenia (np. „Jolanta Cypel”) → tag o tej samej nazwie (tworzony, jeśli go nie ma).
 * Pomijamy „viewers” (informację niesie zdarzenie Viewed) i „Kalendarz dMb” (znacznik źródła, nie kategoria).
 * Kontaktów z innymi wartościami nie ruszamy. Bezpieczne do powtórzenia (dopisuje tylko brakujące powiązania).
 *
 *   npx tsx --env-file=.env scripts/tags-from-contact-from.ts          # na sucho
 *   npx tsx --env-file=.env scripts/tags-from-contact-from.ts --apply  # wykonuje
 *
 * Baza docelowa = DATABASE_URL (host wypisywany na początku).
 */
import { logActivity } from "../lib/activity-log";
import { prisma } from "../lib/prisma";

/** contactFrom → nazwa tagu. */
const MAP: Record<string, string> = {
  PLC: "Perfect Look Clinic",
  "Jolanta Cypel": "Jolanta Cypel",
  "Dorota Wasielewska-Kowalska": "Dorota Wasielewska-Kowalska",
  "Ewelina Korniów-Podlewska": "Ewelina Korniów-Podlewska",
  "Izabela Kropińska-Wojtasiak": "Izabela Kropińska-Wojtasiak",
  "Ilona Jackiewicz-Struska": "Ilona Jackiewicz-Struska",
};

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);

  const plan: { from: string; tag: string; tagExists: boolean; contacts: number; toAdd: string[] }[] = [];
  for (const [from, tagName] of Object.entries(MAP)) {
    const tag = await prisma.tag.findUnique({ where: { name: tagName }, select: { id: true } });
    const contacts = await prisma.contact.findMany({ where: { contactFrom: from }, select: { id: true } });
    const have = new Set(
      tag ? (await prisma.contactTag.findMany({ where: { tagId: tag.id }, select: { contactId: true } })).map((l) => l.contactId) : [],
    );
    plan.push({ from, tag: tagName, tagExists: !!tag, contacts: contacts.length, toAdd: contacts.map((c) => c.id).filter((id) => !have.has(id)) });
  }
  for (const p of plan) {
    console.log(`contactFrom '${p.from}' → tag '${p.tag}' (${p.tagExists ? "istnieje" : "do utworzenia"}): kontaktów ${p.contacts}, do dopisania ${p.toAdd.length}`);
  }
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  let created = 0;
  let added = 0;
  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      let tag = await tx.tag.findUnique({ where: { name: p.tag }, select: { id: true } });
      if (!tag) {
        tag = await tx.tag.create({ data: { name: p.tag }, select: { id: true } });
        created++;
      }
      if (p.toAdd.length) {
        const r = await tx.contactTag.createMany({ data: p.toAdd.map((contactId) => ({ contactId, tagId: tag.id })), skipDuplicates: true });
        added += r.count;
      }
    }
  });
  await logActivity({
    source: "SYSTEM",
    action: "tags.from_contact_from",
    summary: `Dopisano tagi z pola contactFrom (nowych tagów: ${created}, powiązań: ${added})`,
    details: { createdTags: created, added },
  });
  console.log(`Gotowe: nowych tagów ${created}, dopisanych powiązań ${added}.`);
}

main().finally(() => prisma.$disconnect());
