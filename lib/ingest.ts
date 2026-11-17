import { logActivity } from "./activity-log";
import { dropCandidates, upsertCandidates } from "./candidates";
import { cleanOccupation } from "./contacts";
import { nameMatchesProfile, parseViewedAgo, profileReportText, pymkReportText, resolveScrapedAt, reportText, type IngestReport, type ProfileInput, type ProfileReport, type OtwReading, type PymkInput, type PymkReport, type ViewerInput } from "./ingest-core";
import { normalizeProfileUrl } from "./profile-url";
import { prisma } from "./prisma";

/**
 * Ustawia „Open to work” znanym kontaktom wg odczytu z rozszerzenia (true/false; null = brak odczytu, bez zmiany).
 * Każda zmiana trafia do dziennika (`contact.open_to_work`). Zwraca liczby włączonych i wyłączonych.
 */
async function syncOpenToWork(
  people: { profileUrl: string; openToWork: OtwReading }[],
  known: Map<string, { id: string; name: string; openToWork: boolean }>,
  origin: string,
): Promise<{ set: number; cleared: number }> {
  const changes = people.flatMap((p) => {
    const c = known.get(p.profileUrl);
    return c && p.openToWork !== null && p.openToWork !== c.openToWork ? [{ id: c.id, name: c.name, on: p.openToWork }] : [];
  });
  const out = { set: 0, cleared: 0 };
  for (const on of [true, false]) {
    const ids = changes.filter((c) => c.on === on).map((c) => c.id);
    if (!ids.length) continue;
    const res = await prisma.contact.updateMany({ where: { id: { in: ids }, openToWork: !on }, data: { openToWork: on } });
    if (on) out.set = res.count;
    else out.cleared = res.count;
  }
  if (changes.length) {
    await prisma.activityLog.createMany({
      data: changes.map((c) => ({ source: "SYNC" as const, action: "contact.open_to_work", contactId: c.id, summary: `Open to work ${c.on ? "włączono" : "wyłączono"} (odczyt z ${origin}): ${c.name}` })),
    });
  }
  return out;
}

/**
 * Przyjęcie listy „Kto oglądał Twój profil” z rozszerzenia (przez n8n).
 * Znany kontakt: zdarzenie VIEWED_MY_PROFILE, puste „Zajęcie” uzupełniane (istniejącego nie nadpisujemy), „Open to work” ustawiane wg odczytu.
 * Nowa osoba NIE zakłada kontaktu: trafia do poczekalni (lib/candidates.ts, /inbox) razem z momentami wyświetlenia (CandidateView),
 * które po dodaniu kontaktu stają się zdarzeniami VIEWED_MY_PROFILE; odrzucona osoba nie wraca. Imię niezgodne z adresem profilu (błąd rozszerzenia) pomijamy.
 * Zapisy są zbiorcze (kilka zapytań niezależnie od liczby osób): lista ma do 200 pozycji, a baza jest zdalna. Ponowienie tego samego żądania jest bezpieczne
 * (powtórne wyświetlenia są rozpoznawane, adresy unikalne). Zdarzenie VIEWED_MY_PROFILE nie zmienia etapu i nie uruchamia automatyzacji,
 * więc nie przechodzi przez addEventTx. W dzienniku jedno podsumowanie.
 */
export async function ingestViewers(items: ViewerInput[], invalidCount: number, scrapedAtRaw: unknown, now = new Date()): Promise<{ report: IngestReport; message: string }> {
  const scrapedAt = resolveScrapedAt(scrapedAtRaw, now);
  const report: IngestReport = {
    received: items.length + invalidCount,
    skipped: invalidCount,
    queued: [],
    queuedOpenToWork: 0,
    alreadyQueued: 0,
    rejected: 0,
    occupationFilled: 0,
    viewsAdded: 0,
    queuedViews: 0,
    duplicates: 0,
    unclearName: 0,
    archivedViewers: 0,
    openToWorkSet: 0,
    openToWorkCleared: 0,
  };

  const seen = new Set<string>();
  const people: { profileUrl: string; name: string; occupation: string | null; nameOk: boolean; viewed: ReturnType<typeof parseViewedAgo>; openToWork: OtwReading }[] = [];
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
    people.push({ profileUrl, name: item.name, occupation: nameOk ? cleanOccupation(item.occupation) : null, nameOk, viewed: parseViewedAgo(item.viewedAt, scrapedAt), openToWork: item.openToWork });
  }

  try {
    const select = { id: true, profileUrl: true, name: true, occupation: true, archived: true, openToWork: true } as const;
    const known = new Map((await prisma.contact.findMany({ where: { profileUrl: { in: people.map((p) => p.profileUrl) } }, select })).map((c) => [c.profileUrl, c]));

    // nowe osoby (z pewnym imieniem) → poczekalnia
    const fresh = people.filter((p) => !known.has(p.profileUrl) && p.nameOk);
    report.unclearName = people.filter((p) => !known.has(p.profileUrl) && !p.nameOk).length;
    const queue = await upsertCandidates(fresh.map((p) => ({ profileUrl: p.profileUrl, name: p.name, occupation: p.occupation, openToWork: p.openToWork, source: "VIEWERS" as const })), now);
    report.queued = queue.created;
    report.queuedOpenToWork = queue.created.filter((c) => c.openToWork).length;
    report.alreadyQueued = queue.pending;
    report.rejected = queue.rejected;

    // znane kontakty: uzupełnienie pustego „Zajęcia” i „Open to work” wg odczytu
    const fills = people.filter((p) => {
      const c = known.get(p.profileUrl);
      return c && p.occupation && !cleanOccupation(c.occupation);
    });
    if (fills.length) {
      await prisma.$transaction(fills.map((p) => prisma.contact.update({ where: { id: known.get(p.profileUrl)!.id }, data: { occupation: p.occupation } })));
      report.occupationFilled = fills.length;
    }
    const otw = await syncOpenToWork(people, known, "listy oglądających");
    report.openToWorkSet = otw.set;
    report.openToWorkCleared = otw.cleared;

    // wyświetlenia kontaktów: powtórka = istniejące zdarzenie w oknie zaokrąglenia LinkedIn
    const targets = people.filter((p) => known.has(p.profileUrl));
    report.archivedViewers = targets.filter((p) => known.get(p.profileUrl)!.archived).length;
    if (targets.length) {
      const ids = targets.map((p) => known.get(p.profileUrl)!.id);
      const lo = new Date(Math.min(...targets.map((p) => p.viewed.at.getTime() - p.viewed.toleranceMs)));
      const hi = new Date(Math.max(...targets.map((p) => p.viewed.at.getTime() + p.viewed.toleranceMs)));
      const existing = await prisma.contactEvent.findMany({ where: { type: "VIEWED_MY_PROFILE", contactId: { in: ids }, occurredAt: { gte: lo, lte: hi } }, select: { contactId: true, occurredAt: true } });
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
    }

    // wyświetlenia osób z poczekalni: te same okna powtórek
    const queuedTargets = fresh.filter((p) => queue.ids.has(p.profileUrl));
    if (queuedTargets.length) {
      const ids = queuedTargets.map((p) => queue.ids.get(p.profileUrl)!);
      const lo = new Date(Math.min(...queuedTargets.map((p) => p.viewed.at.getTime() - p.viewed.toleranceMs)));
      const hi = new Date(Math.max(...queuedTargets.map((p) => p.viewed.at.getTime() + p.viewed.toleranceMs)));
      const existing = await prisma.candidateView.findMany({ where: { candidateId: { in: ids }, viewedAt: { gte: lo, lte: hi } }, select: { candidateId: true, viewedAt: true } });
      const byCandidate = new Map<string, number[]>();
      for (const e of existing) byCandidate.set(e.candidateId, [...(byCandidate.get(e.candidateId) ?? []), e.viewedAt.getTime()]);
      const add: { candidateId: string; viewedAt: Date }[] = [];
      for (const p of queuedTargets) {
        const candidateId = queue.ids.get(p.profileUrl)!;
        const dup = (byCandidate.get(candidateId) ?? []).some((t) => Math.abs(t - p.viewed.at.getTime()) <= p.viewed.toleranceMs);
        if (dup) report.duplicates++;
        else add.push({ candidateId, viewedAt: p.viewed.at });
      }
      if (add.length) await prisma.candidateView.createMany({ data: add });
      report.queuedViews = add.length;
    }
    // osoba, która stała się kontaktem inną drogą, nie powinna wisieć w poczekalni (jej wyświetlenia przechodzą na kontakt)
    await dropCandidates([...known.keys()]);
  } catch (e) {
    await logActivity({ source: "SYNC", action: "ingest.profile_viewers", level: "ERROR", summary: `Kto oglądał profil: błąd przetwarzania (${e instanceof Error ? e.message.slice(0, 200) : "nieznany"})` });
    throw e;
  }

  await logActivity({
    source: "SYNC",
    action: "ingest.profile_viewers",
    summary: `Kto oglądał profil: sprawdzono ${report.received - report.skipped}, do poczekalni ${report.queued.length}, już czekało ${report.alreadyQueued}, odrzuconych ${report.rejected}, wyświetleń ${report.viewsAdded + report.queuedViews}, powtórek ${report.duplicates}${report.unclearName ? `, niepewnych imion ${report.unclearName}` : ""}`,
    details: {
      received: report.received,
      skipped: report.skipped,
      queued: report.queued.length,
      queuedOpenToWork: report.queuedOpenToWork,
      alreadyQueued: report.alreadyQueued,
      rejected: report.rejected,
      occupationFilled: report.occupationFilled,
      viewsAdded: report.viewsAdded,
      queuedViews: report.queuedViews,
      duplicates: report.duplicates,
      unclearName: report.unclearName,
      archivedViewers: report.archivedViewers,
      openToWorkSet: report.openToWorkSet,
      openToWorkCleared: report.openToWorkCleared,
    },
  });
  return { report, message: reportText(report) };
}

/**
 * Przyjęcie danych ze strony profilu (content6.js, przez n8n). Nowa osoba (z pewnym imieniem) → kontakt „Zebrany”, `source = PROFILE`.
 * Znany kontakt: uzupełniamy puste „Lokalizację” i „Zajęcie” (niepustych nie nadpisujemy), a „Open to work” ustawiamy wg odczytu
 * (true/false z rozszerzenia; brak pola = nie odczytywano, bez zmiany). Zarchiwizowany zostaje zarchiwizowany.
 * Bez zdarzeń, więc etap się nie zmienia. Ponowienie tego samego żądania jest bezpieczne (unikalny adres, wypełniamy tylko braki).
 */
export async function ingestProfile(item: ProfileInput): Promise<{ report: ProfileReport; message: string }> {
  const profileUrl = normalizeProfileUrl(item.profileUrl);
  const base = { name: item.name, profileUrl, filled: [] as string[], openToWork: item.openToWork, otwChanged: null as "on" | "off" | null, archived: false };
  let report: ProfileReport;
  if (!profileUrl) {
    report = { ...base, outcome: "skipped-url" };
  } else {
    try {
      const occupation = cleanOccupation(item.occupation);
      const existing = await prisma.contact.findUnique({ where: { profileUrl }, select: { id: true, name: true, location: true, occupation: true, openToWork: true, archived: true } });
      if (existing) {
        const data: { location?: string; occupation?: string; openToWork?: boolean } = {};
        if (item.location && !existing.location?.trim()) data.location = item.location;
        if (occupation && !cleanOccupation(existing.occupation)) data.occupation = occupation;
        if (item.openToWork !== null && item.openToWork !== existing.openToWork) data.openToWork = item.openToWork;
        const filled = Object.keys(data);
        if (filled.length) await prisma.contact.update({ where: { id: existing.id }, data });
        const otwChanged = data.openToWork === undefined ? null : data.openToWork ? ("on" as const) : ("off" as const);
        report = { ...base, name: existing.name, filled, otwChanged, archived: existing.archived, outcome: filled.length ? "updated" : "unchanged" };
        if (filled.length) await logActivity({ source: "SYNC", action: "contact.profile_updated", contactId: existing.id, summary: `Dane profilu: ${existing.name} (uzupełniono: ${filled.join(", ")})` });
      } else if (!nameMatchesProfile(item.name, profileUrl)) {
        report = { ...base, outcome: "skipped-name" };
      } else {
        const created = await prisma.contact.createManyAndReturn({
          data: [{ profileUrl, name: item.name, location: item.location, occupation, openToWork: item.openToWork === true, source: "PROFILE" as const }],
          skipDuplicates: true,
          select: { id: true, name: true },
        });
        report = { ...base, outcome: created.length ? "created" : "unchanged" };
        await dropCandidates([profileUrl]);
        if (created.length) await logActivity({ source: "SYNC", action: "contact.created", contactId: created[0].id, summary: `Nowy kontakt ze strony profilu: ${created[0].name}` });
      }
    } catch (e) {
      await logActivity({ source: "SYNC", action: "ingest.profile", level: "ERROR", summary: `Dane profilu: błąd przetwarzania (${e instanceof Error ? e.message.slice(0, 200) : "nieznany"})` });
      throw e;
    }
  }
  await logActivity({
    source: "SYNC",
    action: "ingest.profile",
    level: report.outcome.startsWith("skipped") ? "WARN" : "INFO",
    summary: `Dane profilu: ${report.outcome}${report.filled.length ? ` (${report.filled.join(", ")})` : ""}`,
    details: { outcome: report.outcome, filled: report.filled, openToWork: report.openToWork, otwChanged: report.otwChanged, archived: report.archived },
  });
  return { report, message: profileReportText(report) };
}

/**
 * Przyjęcie osób z popupu „People you may know” (content4.js, przez n8n). Nowe osoby NIE zakładają kontaktów: trafiają do poczekalni
 * (lib/candidates.ts, strona /inbox), gdzie użytkownik wybiera, kogo dodać, a kogo odrzucić; odrzuceni nie wracają przy kolejnych importach.
 * Znany kontakt: puste „Zajęcie” uzupełniane (niepustego nie nadpisujemy), „Open to work” ustawiane wg odczytu (true/false; brak pola = bez zmiany);
 * zarchiwizowany zostaje zarchiwizowany. Imię pochodzi z przycisku „Invite … to connect” tej samej karty, więc bez straży imienia jak przy liście oglądających.
 * Bez zdarzeń (etap się nie zmienia). Zapisy zbiorcze; ponowienie tego samego żądania jest bezpieczne.
 */
export async function ingestPymk(items: PymkInput[], invalidCount: number): Promise<{ report: PymkReport; message: string }> {
  const report: PymkReport = {
    received: items.length + invalidCount,
    skipped: invalidCount,
    queued: [],
    queuedOpenToWork: 0,
    alreadyQueued: 0,
    rejected: 0,
    known: 0,
    occupationFilled: 0,
    openToWorkSet: 0,
    openToWorkCleared: 0,
  };

  const seen = new Set<string>();
  const people: { profileUrl: string; name: string; occupation: string | null; openToWork: OtwReading }[] = [];
  for (const item of items) {
    const profileUrl = normalizeProfileUrl(item.profileUrl);
    if (!profileUrl) {
      report.skipped++;
      continue;
    }
    if (seen.has(profileUrl)) continue;
    seen.add(profileUrl);
    people.push({ profileUrl, name: item.name, occupation: cleanOccupation(item.occupation), openToWork: item.openToWork });
  }

  try {
    const select = { id: true, profileUrl: true, name: true, occupation: true, openToWork: true } as const;
    const known = new Map((await prisma.contact.findMany({ where: { profileUrl: { in: people.map((p) => p.profileUrl) } }, select })).map((c) => [c.profileUrl, c]));
    report.known = known.size;

    // nie-kontakty → poczekalnia
    const queue = await upsertCandidates(people.filter((p) => !known.has(p.profileUrl)));
    report.queued = queue.created;
    report.queuedOpenToWork = queue.created.filter((c) => c.openToWork).length;
    report.alreadyQueued = queue.pending;
    report.rejected = queue.rejected;

    // znane kontakty: uzupełnienie pustego „Zajęcia” i „Open to work” wg odczytu
    const fills = people.filter((p) => {
      const c = known.get(p.profileUrl);
      return c && p.occupation && !cleanOccupation(c.occupation);
    });
    if (fills.length) {
      await prisma.$transaction(fills.map((p) => prisma.contact.update({ where: { id: known.get(p.profileUrl)!.id }, data: { occupation: p.occupation } })));
      report.occupationFilled = fills.length;
    }
    const otw = await syncOpenToWork(people, known, "„People you may know”");
    report.openToWorkSet = otw.set;
    report.openToWorkCleared = otw.cleared;
    // osoba, która stała się kontaktem inną drogą, nie powinna wisieć w poczekalni
    await dropCandidates([...known.keys()]);
  } catch (e) {
    await logActivity({ source: "SYNC", action: "ingest.pymk", level: "ERROR", summary: `People you may know: błąd przetwarzania (${e instanceof Error ? e.message.slice(0, 200) : "nieznany"})` });
    throw e;
  }

  await logActivity({
    source: "SYNC",
    action: "ingest.pymk",
    summary: `People you may know: sprawdzono ${report.received - report.skipped}, do poczekalni ${report.queued.length}, już czekało ${report.alreadyQueued}, odrzuconych ${report.rejected}, kontaktów ${report.known}`,
    details: {
      received: report.received,
      skipped: report.skipped,
      queued: report.queued.length,
      queuedOpenToWork: report.queuedOpenToWork,
      alreadyQueued: report.alreadyQueued,
      rejected: report.rejected,
      known: report.known,
      occupationFilled: report.occupationFilled,
      openToWorkSet: report.openToWorkSet,
      openToWorkCleared: report.openToWorkCleared,
    },
  });
  return { report, message: pymkReportText(report) };
}
