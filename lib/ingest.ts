import { logActivity } from "./activity-log";
import { addEventTx } from "./contact-events";
import { cleanOccupation } from "./contacts";
import { parseViewedAgo, resolveScrapedAt, reportText, type IngestReport, type ViewerInput } from "./ingest-core";
import { normalizeProfileUrl } from "./profile-url";
import { prisma } from "./prisma";

/**
 * Przyjęcie listy „Kto oglądał Twój profil” z rozszerzenia (przez n8n): nowa osoba → kontakt na etapie „Zebrany”,
 * każdemu kontaktowi zdarzenie VIEWED_MY_PROFILE (nie zmienia etapu), puste „Zajęcie” zostaje uzupełnione (istniejącego nie nadpisujemy).
 * Jedna transakcja na osobę, więc błąd jednej pozycji nie cofa pozostałych. W dzienniku jedno podsumowanie + wpis przy każdym nowym kontakcie.
 */
export async function ingestViewers(items: ViewerInput[], invalidCount: number, scrapedAtRaw: unknown, now = new Date()): Promise<{ report: IngestReport; message: string }> {
  const scrapedAt = resolveScrapedAt(scrapedAtRaw, now);
  const report: IngestReport = { received: items.length + invalidCount, skipped: invalidCount, created: [], occupationFilled: 0, viewsAdded: 0, duplicates: 0, archivedViewers: 0 };
  const seen = new Set<string>();
  let failed = 0;

  for (const item of items) {
    const profileUrl = normalizeProfileUrl(item.profileUrl);
    if (!profileUrl || seen.has(profileUrl)) {
      if (!profileUrl) report.skipped++;
      continue;
    }
    seen.add(profileUrl);
    const viewed = parseViewedAgo(item.viewedAt, scrapedAt);
    try {
      await prisma.$transaction(async (tx) => {
        let contact = await tx.contact.findUnique({ where: { profileUrl }, select: { id: true, name: true, occupation: true, archived: true } });
        if (!contact) {
          contact = await tx.contact.create({
            data: { profileUrl, name: item.name, occupation: item.occupation, source: "VIEWERS" },
            select: { id: true, name: true, occupation: true, archived: true },
          });
          report.created.push({ name: contact.name, profileUrl });
          await logActivity({ source: "SYNC", action: "contact.created", contactId: contact.id, summary: `Nowy kontakt z listy oglądających: ${contact.name}` }, tx);
        } else if (item.occupation && !cleanOccupation(contact.occupation)) {
          await tx.contact.update({ where: { id: contact.id }, data: { occupation: item.occupation } });
          report.occupationFilled++;
        }
        if (contact.archived) report.archivedViewers++;

        const from = new Date(viewed.at.getTime() - viewed.toleranceMs);
        const to = new Date(viewed.at.getTime() + viewed.toleranceMs);
        const dup = await tx.contactEvent.count({ where: { contactId: contact.id, type: "VIEWED_MY_PROFILE", occurredAt: { gte: from, lte: to } } });
        if (dup > 0) {
          report.duplicates++;
          return;
        }
        await addEventTx(tx, contact.id, { type: "VIEWED_MY_PROFILE", occurredAt: viewed.at }, { skipLog: true });
        report.viewsAdded++;
      });
    } catch (e) {
      failed++;
      console.error("ingest viewer:", e instanceof Error ? e.message : e);
    }
  }
  // liczniki z transakcji, która się cofnęła, mogły już wzrosnąć: przy błędzie raport jest przybliżony, a wpis dziennika ma poziom WARN
  await logActivity({
    source: "SYNC",
    action: "ingest.profile_viewers",
    level: failed ? "WARN" : "INFO",
    summary: `Kto oglądał profil: sprawdzono ${report.received - report.skipped}, nowych kontaktów ${report.created.length}, wyświetleń ${report.viewsAdded}, powtórek ${report.duplicates}${failed ? `, błędów ${failed}` : ""}`,
    details: { received: report.received, skipped: report.skipped, created: report.created.length, occupationFilled: report.occupationFilled, viewsAdded: report.viewsAdded, duplicates: report.duplicates, archivedViewers: report.archivedViewers, failed },
  });
  return { report, message: reportText(report) };
}
