// Przenosi adres wątku LinkedIn z notatek przypomnień ("Wątek: https://www.linkedin.com/messaging/thread/…", ślad po imporcie z kalendarza)
// do pola kontaktu `threadUrl`. Dotyczy tylko kontaktów, które jeszcze nie mają wątku. Notatek przypomnień nie zmienia.
//
//   npx tsx scripts/backfill-thread-url.ts           # DRY RUN (nic nie zapisuje)
//   npx tsx scripts/backfill-thread-url.ts --apply   # zapis
//
// Gdy kontakt ma kilka różnych wątków w przypomnieniach, wybieramy z najnowszego przypomnienia (i wypisujemy takie przypadki).
import { PrismaClient } from "@prisma/client";
import { extractThreadUrl, normalizeThreadUrl } from "../lib/calendar-parse";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.reminder.findMany({
    where: { note: { contains: "linkedin.com/messaging/thread", mode: "insensitive" }, contact: { threadUrl: null } },
    orderBy: { createdAt: "desc" },
    select: { contactId: true, note: true, contact: { select: { name: true } } },
  });
  const byContact = new Map<string, { name: string; urls: string[] }>();
  for (const r of rows) {
    const url = normalizeThreadUrl(extractThreadUrl(r.note ?? ""));
    if (!url) continue;
    const e = byContact.get(r.contactId) ?? { name: r.contact.name, urls: [] };
    if (!e.urls.includes(url)) e.urls.push(url);
    byContact.set(r.contactId, e);
  }
  const multi = [...byContact.values()].filter((e) => e.urls.length > 1);
  if (APPLY) {
    for (const [contactId, e] of byContact) await prisma.contact.update({ where: { id: contactId }, data: { threadUrl: e.urls[0] } });
  }
  console.log(JSON.stringify({ mode: APPLY ? "APPLY" : "DRY-RUN", contactsToUpdate: byContact.size, withSeveralDifferentThreads: multi.length }));
  for (const e of multi.slice(0, 10)) console.log("  kilka wątków:", e.name, "→ wybrany najnowszy");
}
main().finally(() => prisma.$disconnect());
