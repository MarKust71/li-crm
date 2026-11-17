import type { CandidateStatus, Prisma } from "@prisma/client";
import { logActivity } from "./activity-log";
import { cleanOccupation } from "./contacts";
import { prisma } from "./prisma";

// Poczekalnia (tabela Candidate): osoby z masowych importów („People you may know”), które jeszcze nie są kontaktami.
// Użytkownik wybiera, kogo dodać (powstaje Contact „Zebrany”), a kogo odrzucić (wiersz zostaje jako REJECTED, żeby import jej nie przywracał).

export const CANDIDATE_PAGE_SIZE = 100;

export type CandidateFilters = { status: CandidateStatus; q: string; otw: boolean; page: number };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** `widok=odrzucone` → odrzucone, inaczej oczekujące; `q` szukane w imieniu i zajęciu; `otw=1` tylko z „Open to work”. */
export function parseCandidateFilters(params: Params): CandidateFilters {
  return {
    status: first(params.widok) === "odrzucone" ? "REJECTED" : "PENDING",
    q: first(params.q).trim().slice(0, 100),
    otw: first(params.otw) === "1",
    page: Math.max(1, Math.floor(Number(first(params.page))) || 1),
  };
}

function where(f: CandidateFilters): Prisma.CandidateWhereInput {
  return {
    status: f.status,
    ...(f.otw ? { openToWork: true } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { occupation: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
}

export async function listCandidates(f: CandidateFilters) {
  const w = where(f);
  const total = await prisma.candidate.count({ where: w });
  const pages = Math.max(1, Math.ceil(total / CANDIDATE_PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const rows = await prisma.candidate.findMany({
    where: w,
    orderBy: [{ openToWork: "desc" }, { lastSeenAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * CANDIDATE_PAGE_SIZE,
    take: CANDIDATE_PAGE_SIZE,
  });
  return { rows, total, pages, page };
}

/** Liczby do zakładek i do znacznika w menu. */
export async function candidateCounts(): Promise<{ pending: number; rejected: number }> {
  const [pending, rejected] = await Promise.all([prisma.candidate.count({ where: { status: "PENDING" } }), prisma.candidate.count({ where: { status: "REJECTED" } })]);
  return { pending, rejected };
}

export const countPendingCandidates = () => prisma.candidate.count({ where: { status: "PENDING" } });

export type CandidateInput = { profileUrl: string; name: string; occupation: string | null; openToWork: boolean | null };

/**
 * Zapis osób z importu do poczekalni (zbiorczo). Nowa → PENDING; już czekająca lub odrzucona → odświeżamy „ostatnio widziana”, licznik,
 * puste „Zajęcie” i aktualny „Open to work” (brak odczytu = bez zmiany). Status odrzuconej zostaje, więc import jej nie przywraca.
 */
export async function upsertCandidates(
  people: CandidateInput[],
  now = new Date(),
): Promise<{ created: { name: string; profileUrl: string; openToWork: boolean }[]; pending: number; rejected: number }> {
  if (!people.length) return { created: [], pending: 0, rejected: 0 };
  const existing = new Map(
    (await prisma.candidate.findMany({ where: { profileUrl: { in: people.map((p) => p.profileUrl) } }, select: { id: true, profileUrl: true, occupation: true, openToWork: true, status: true } })).map((c) => [c.profileUrl, c]),
  );

  const fresh = people.filter((p) => !existing.has(p.profileUrl));
  const created: { name: string; profileUrl: string; openToWork: boolean }[] = [];
  if (fresh.length) {
    const rows = await prisma.candidate.createManyAndReturn({
      data: fresh.map((p) => ({ profileUrl: p.profileUrl, name: p.name, occupation: p.occupation, openToWork: p.openToWork === true, firstSeenAt: now, lastSeenAt: now })),
      skipDuplicates: true, // równoległe ponowienie tego samego żądania
      select: { profileUrl: true, name: true, openToWork: true },
    });
    created.push(...rows);
  }

  const seen = people.filter((p) => existing.has(p.profileUrl));
  if (seen.length) {
    await prisma.$transaction(
      seen.map((p) => {
        const c = existing.get(p.profileUrl)!;
        return prisma.candidate.update({
          where: { id: c.id },
          data: {
            lastSeenAt: now,
            seenCount: { increment: 1 },
            ...(p.occupation && !cleanOccupation(c.occupation) ? { occupation: p.occupation } : {}),
            ...(p.openToWork !== null && p.openToWork !== c.openToWork ? { openToWork: p.openToWork } : {}),
          },
        });
      }),
    );
  }
  return {
    created,
    pending: seen.filter((p) => existing.get(p.profileUrl)!.status === "PENDING").length,
    rejected: seen.filter((p) => existing.get(p.profileUrl)!.status === "REJECTED").length,
  };
}

/** Kontakt założono inną drogą (profil, lista oglądających): jego wpis w poczekalni jest już zbędny. */
export async function dropCandidates(profileUrls: string[]): Promise<void> {
  if (profileUrls.length) await prisma.candidate.deleteMany({ where: { profileUrl: { in: profileUrls } } });
}

/** „Dodaj zaznaczone”: z czekających powstają kontakty „Zebrany” (`source = PYMK`), wpisy znikają z poczekalni. Zwraca liczby. */
export async function acceptCandidates(ids: string[]): Promise<{ added: number; alreadyContacts: number }> {
  if (!ids.length) return { added: 0, alreadyContacts: 0 };
  return prisma.$transaction(async (tx) => {
    const picked = await tx.candidate.findMany({ where: { id: { in: ids }, status: "PENDING" } });
    if (!picked.length) return { added: 0, alreadyContacts: 0 };
    const created = await tx.contact.createManyAndReturn({
      data: picked.map((c) => ({ profileUrl: c.profileUrl, name: c.name, occupation: c.occupation, openToWork: c.openToWork, source: "PYMK" as const })),
      skipDuplicates: true, // adres mógł w międzyczasie stać się kontaktem
      select: { id: true, name: true },
    });
    await tx.candidate.deleteMany({ where: { id: { in: picked.map((c) => c.id) } } });
    if (created.length) {
      await tx.activityLog.createMany({
        data: created.map((c) => ({ source: "UI" as const, action: "contact.created", contactId: c.id, summary: `Dodano kontakt z poczekalni: ${c.name}` })),
      });
    }
    await logActivity({ source: "UI", action: "inbox.accepted", summary: `Poczekalnia: dodano ${created.length} kontaktów`, details: { added: created.length, picked: picked.length } }, tx);
    return { added: created.length, alreadyContacts: picked.length - created.length };
  });
}

/** „Odrzuć zaznaczone”: czekające → odrzucone (ukryte, import ich nie przywraca). */
export async function rejectCandidates(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const res = await prisma.candidate.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "REJECTED" } });
  if (res.count) await logActivity({ source: "UI", action: "inbox.rejected", summary: `Poczekalnia: odrzucono ${res.count} osób`, details: { count: res.count } });
  return res.count;
}

/** „Przywróć zaznaczone”: odrzucone → znów czekają na decyzję. */
export async function restoreCandidates(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const res = await prisma.candidate.updateMany({ where: { id: { in: ids }, status: "REJECTED" }, data: { status: "PENDING" } });
  if (res.count) await logActivity({ source: "UI", action: "inbox.restored", summary: `Poczekalnia: przywrócono ${res.count} osób`, details: { count: res.count } });
  return res.count;
}
