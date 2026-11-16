// TYLKO ODCZYT. (1) Szuka kontaktów z listy „Kto oglądał profil” (source = VIEWERS), których imię nie pasuje do adresu profilu: ślad po błędzie
// rozszerzenia (karta bez własnego przycisku „Message” dostawała imię pierwszej karty z listy). (2) Szuka kontaktów zmienionych w tym czasie,
// których „Zajęcie” jest takie samo jak imię (stary kod mógł wpisać tam prawdziwe imię osoby). Nic nie zmienia ani nie usuwa; poprawki robisz ręcznie na karcie kontaktu.
//
//   npx tsx scripts/check-viewer-names.ts            # kontakty utworzone w ostatnich 3 dniach
//   npx tsx scripts/check-viewer-names.ts --days 14  # inny zakres
//
// Produkcja (baza z .env.production.local):
//   set -a; . ./.env.production.local; set +a; npx tsx scripts/check-viewer-names.ts
import { PrismaClient } from "@prisma/client";
import { nameMatchesProfile } from "../lib/ingest-core";

const prisma = new PrismaClient();
const daysArg = process.argv.indexOf("--days");
const days = daysArg > -1 ? Math.max(1, Number(process.argv[daysArg + 1]) || 3) : 3;

async function main() {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await prisma.contact.findMany({
    where: { source: "VIEWERS", createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, profileUrl: true, occupation: true, stage: true, createdAt: true, info: true, _count: { select: { events: true } } },
  });
  const bad = rows.filter((r) => !nameMatchesProfile(r.name, r.profileUrl));
  const byName = new Map<string, number>();
  for (const r of rows) byName.set(r.name, (byName.get(r.name) ?? 0) + 1);

  console.log(`Kontakty z listy oglądających utworzone w ostatnich ${days} dniach: ${rows.length}`);
  console.log(`Imię niezgodne z adresem profilu: ${bad.length}\n`);
  for (const r of bad) {
    console.log(`• ${r.name}  [${r.createdAt.toISOString().slice(0, 16)}]  etap ${r.stage}, zdarzeń ${r._count.events}${r.info ? ", ma notatkę" : ""}`);
    console.log(`    ${r.profileUrl}`);
    if (r.occupation) console.log(`    zajęcie: ${r.occupation}   (zwykle to prawdziwe imię osoby)`);
  }
  const dup = [...byName].filter(([, n]) => n > 1);
  if (dup.length) console.log(`\nImiona powtórzone u różnych kontaktów w tym zakresie: ${dup.map(([n, c]) => `${n} ×${c}`).join(", ")}`);

  // (2) „Zajęcie” równe imieniu, wśród kontaktów zmienionych w tym zakresie (dowolne źródło)
  const fold = (v: string | null) => (v ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const touched = await prisma.contact.findMany({
    where: { updatedAt: { gte: since }, occupation: { not: null } },
    orderBy: { updatedAt: "asc" },
    select: { name: true, occupation: true, profileUrl: true, updatedAt: true },
  });
  const same = touched.filter((c) => fold(c.occupation) !== "" && fold(c.occupation) === fold(c.name));
  console.log(`\nKontakty zmienione w tym czasie, których „Zajęcie” jest identyczne z imieniem: ${same.length}`);
  for (const c of same) {
    console.log(`• ${c.name}  [zmieniony ${c.updatedAt.toISOString().slice(0, 16)}]  zajęcie: ${c.occupation}`);
    console.log(`    ${c.profileUrl}`);
  }
  console.log("\nBrak zmian w bazie (skrypt tylko czyta).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
