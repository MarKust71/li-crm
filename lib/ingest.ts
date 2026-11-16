import { logActivity } from "./activity-log";
import { cleanOccupation } from "./contacts";
import { nameMatchesProfile, parseViewedAgo, resolveScrapedAt, reportText, type IngestReport, type ViewerInput } from "./ingest-core";
import { normalizeProfileUrl } from "./profile-url";
import { prisma } from "./prisma";

/**
 * Przyjęcie listy „Kto oglądał Twój profil” z rozszerzenia (przez n8n): nowa osoba → kontakt na etapie „Zebrany”,
 * każdemu kontaktowi zdarzenie VIEWED_MY_PROFILE, puste „Zajęcie” zostaje uzupełnione (istniejącego nie nadpisujemy).
 * Zapisy są zbiorcze (kilka zapytań niezależnie od liczby osób): lista ma do 200 pozycji, a baza jest zdalna, więc zapis osoba po osobie
 * nie mieścił się w limicie czasu. Ponowienie tego samego żądania jest bezpieczne (powtórne wyświetlenia są rozpoznawane, kontakty mają unikalny adres).
 * Zdarzenie VIEWED_MY_PROFILE nie zmienia etapu i nie uruchamia automatyzacji, więc nie przechodzi przez addEventTx (przeliczanie etapu).
 * W dzienniku jedno podsumowanie + wpis przy każdym nowym kontakcie.
 */
export async function ingestViewers(items: ViewerInput[], invalidCount: number, scrapedAtRaw: unknown, now = new Date()): Promise<{ report: IngestReport; message: string }> {
  const scrapedAt = resolveScrapedAt(scrapedAtRaw, now);
  const report: IngestReport = { received: items.length + invalidCount, skipped: invalidCount, created: [], occupationFilled: 0, viewsAdded: 0, duplicates: 0, unclearName: 0, archivedViewers: 0 };

  const seen = new Set<string>();
  const people: { profileUrl: string; name: string; occupation: string | null; nameOk: boolean; viewed: ReturnType<typeof parseViewedAgo> }[] = [];
  for (const item of items) {
    const profileUrl = normalizeProfileUrl(item.profileUrl);
    if (!profileUrl) {
      report.skipped++;
      continue;
    }
    if (seen.has(profileUrl)) continue;
    seen.add(profileUrl);
    const nameOk = nameMatchesProfile(item.name, profileUrl);
    // przy niezgodnym imieniu także „zajęcie” jest nie do zaufania (rozszerzenie wstawia tam prawdziwe imię)
    people.push({ profileUrl, name: item.name, occupation: nameOk ? cleanOccupation(item.occupation) : null, nameOk, viewed: parseViewedAgo(item.viewedAt, scrapedAt) });
  }

  try {
    const select = { id: true, profileUrl: true, name: true, occupation: true, archived: true } as const;
    const urls = people.map((p) => p.profileUrl);
    const known = new Map((await prisma.contact.findMany({ where: { profileUrl: { in: urls } }, select })).map((c) => [c.profileUrl, c]));

    // nowe osoby (z pewnym imieniem); skipDuplicates chroni przed równoległym ponowieniem tego samego żądania
    const fresh = people.filter((p) => !known.has(p.profileUrl) && p.nameOk);
    report.unclearName = people.filter((p) => !known.has(p.profileUrl) && !p.nameOk).length;
    if (fresh.length) {
      const created = await prisma.contact.createManyAndReturn({
        data: fresh.map((p) => ({ profileUrl: p.profileUrl, name: p.name, occupation: p.occupation, source: "VIEWERS" as const })),
        skipDuplicates: true,
        select,
      });
      for (const c of created) {
        known.set(c.profileUrl, c);
        report.created.push({ name: c.name, profileUrl: c.profileUrl });
      }
      if (created.length) {
        await prisma.activityLog.createMany({
          data: created.map((c) => ({ source: "SYNC" as const, action: "contact.created", contactId: c.id, summary: `Nowy kontakt z listy oglądających: ${c.name}` })),
        });
      }
      // kontakt mógł powstać równolegle (ponowione żądanie): dociągnij brakujące
      const missing = fresh.filter((p) => !known.has(p.profileUrl)).map((p) => p.profileUrl);
      if (missing.length) for (const c of await prisma.contact.findMany({ where: { profileUrl: { in: missing } }, select })) known.set(c.profileUrl, c);
    }

    // uzupełnienie pustego „Zajęcia” u kontaktów, które już były
    const createdUrls = new Set(report.created.map((c) => c.profileUrl));
    const fills = people.filter((p) => {
      const c = known.get(p.profileUrl);
      return c && !createdUrls.has(p.profileUrl) && p.occupation && !cleanOccupation(c.occupation);
    });
    if (fills.length) {
      await prisma.$transaction(fills.map((p) => prisma.contact.update({ where: { id: known.get(p.profileUrl)!.id }, data: { occupation: p.occupation } })));
      report.occupationFilled = fills.length;
    }

    // wyświetlenia: powtórka = istniejące zdarzenie w oknie zaokrąglenia LinkedIn
    const targets = people.filter((p) => known.has(p.profileUrl));
    report.archivedViewers = targets.filter((p) => known.get(p.profileUrl)!.archived).length;
    const ids = targets.map((p) => known.get(p.profileUrl)!.id);
    const lo = new Date(Math.min(...targets.map((p) => p.viewed.at.getTime() - p.viewed.toleranceMs)));
    const hi = new Date(Math.max(...targets.map((p) => p.viewed.at.getTime() + p.viewed.toleranceMs)));
    const existing = targets.length
      ? await prisma.contactEvent.findMany({ where: { type: "VIEWED_MY_PROFILE", contactId: { in: ids }, occurredAt: { gte: lo, lte: hi } }, select: { contactId: true, occurredAt: true } })
      : [];
    const byContact = new Map<string, number[]>();
    for (const e of existing) byContact.set(e.contactId, [...(byContact.get(e.contactId) ?? []), e.occurredAt.getTime()]);
    const add: { contactId: string; type: "VIEWED_MY_PROFILE"; occurredAt: Date }[] = [];
    for (const p of targets) {
      const contactId = known.get(p.profileUrl)!.id;
      const dup = (byContact.get(contactId) ?? []).some((t) => Math.abs(t - p.viewed.at.getTime()) <= p.viewed.toleranceMs);
      if (dup) report.duplicates++;
      else add.push({ contactId, type: "VIEWED_MY_PROFILE", occurredAt: p.viewed.at });
    }
    if (add.length) await prisma.contactEvent.createMany({ data: add });
    report.viewsAdded = add.length;
  } catch (e) {
    await logActivity({ source: "SYNC", action: "ingest.profile_viewers", level: "ERROR", summary: `Kto oglądał profil: błąd przetwarzania (${e instanceof Error ? e.message.slice(0, 200) : "nieznany"})` });
    throw e;
  }

  await logActivity({
    source: "SYNC",
    action: "ingest.profile_viewers",
    summary: `Kto oglądał profil: sprawdzono ${report.received - report.skipped}, nowych kontaktów ${report.created.length}, wyświetleń ${report.viewsAdded}, powtórek ${report.duplicates}${report.unclearName ? `, niepewnych imion ${report.unclearName}` : ""}`,
    details: { received: report.received, skipped: report.skipped, created: report.created.length, occupationFilled: report.occupationFilled, viewsAdded: report.viewsAdded, duplicates: report.duplicates, unclearName: report.unclearName, archivedViewers: report.archivedViewers },
  });
  return { report, message: reportText(report) };
}
