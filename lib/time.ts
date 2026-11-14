import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const ENTRIES_PAGE_SIZE = 30;
export const MAX_COUNT = 100000;

export type TimeResult = { ok: true } | { ok: false; error: string };

// ───────────────────────── czynności ─────────────────────────

/** Czynności od najczęściej używanych (do selecta). */
export async function listActivityTypes() {
  const rows = await prisma.activityType.findMany({
    select: { id: true, name: true, _count: { select: { entries: true } } },
  });
  return rows
    .sort((a, b) => b._count.entries - a._count.entries || a.name.localeCompare(b.name, "pl"))
    .map((r) => ({ id: r.id, name: r.name, uses: r._count.entries }));
}

/** Nowa nazwa ma pierwszeństwo (get-or-create bez rozróżniania wielkości liter), potem wybrane id. */
export async function resolveActivityId(activityId: string | null, newName: string | null): Promise<string | null> {
  if (newName) {
    const existing = await prisma.activityType.findFirst({
      where: { name: { equals: newName, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return existing.id;
    try {
      return (await prisma.activityType.create({ data: { name: newName }, select: { id: true } })).id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return (await prisma.activityType.findUnique({ where: { name: newName }, select: { id: true } }))?.id ?? null;
      }
      throw e;
    }
  }
  if (activityId) {
    return (await prisma.activityType.findUnique({ where: { id: activityId }, select: { id: true } }))?.id ?? null;
  }
  return null;
}

// ───────────────────────── sesja start/stop ─────────────────────────

export async function getRunningEntry() {
  return prisma.timeEntry.findFirst({
    where: { endedAt: null },
    select: { id: true, startedAt: true, count: true, note: true, activityType: { select: { id: true, name: true } } },
  });
}

/** Czy sesja trwa podejrzanie długo (np. zapomniana wczoraj): UI ostrzega, żeby sprawdzić godziny. */
export function isLongRunning(startedAt: Date, hours = 12): boolean {
  return Date.now() - startedAt.getTime() > hours * 3600 * 1000;
}

/** Najwyżej jedna trwająca sesja: pilnuje tego częściowy indeks unikalny w bazie (migracja time_entry_single_running). */
export async function startSession(activityId: string | null): Promise<TimeResult> {
  try {
    await prisma.timeEntry.create({ data: { startedAt: new Date(), activityTypeId: activityId } });
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, error: "running" };
    throw e;
  }
}

type EntryInput = {
  startedAt: Date;
  endedAt: Date;
  activityId: string | null;
  count: number | null;
  note: string | null;
};

export async function stopSession(id: string, input: Partial<Pick<EntryInput, "startedAt">> & Omit<EntryInput, "startedAt">): Promise<TimeResult> {
  const entry = await prisma.timeEntry.findUnique({ where: { id }, select: { startedAt: true, endedAt: true } });
  if (!entry || entry.endedAt) return { ok: false, error: "notfound" };
  const startedAt = input.startedAt ?? entry.startedAt;
  if (input.endedAt < startedAt) return { ok: false, error: "end_before_start" };
  // warunek endedAt: null chroni przed zakończeniem tej samej sesji dwa razy
  const res = await prisma.timeEntry.updateMany({
    where: { id, endedAt: null },
    data: { startedAt, endedAt: input.endedAt, activityTypeId: input.activityId, count: input.count, note: input.note },
  });
  return res.count === 1 ? { ok: true } : { ok: false, error: "notfound" };
}

/**
 * Czasy są opcjonalne: pominięte (formularz ma dokładność do minuty) zostają dokładnie takie, jak w bazie,
 * więc zapis samej notatki nie obcina sekund. Kolejność start ≤ koniec sprawdzamy tylko po zmianie czasu,
 * żeby dało się poprawić inne pola wpisu, który już wcześniej miał koniec przed początkiem (import).
 */
export async function updateEntry(
  id: string,
  input: { startedAt?: Date; endedAt?: Date; activityId: string | null; count: number | null; note: string | null },
): Promise<TimeResult> {
  const entry = await prisma.timeEntry.findUnique({ where: { id }, select: { startedAt: true, endedAt: true } });
  if (!entry || !entry.endedAt) return { ok: false, error: "notfound" };
  const startedAt = input.startedAt ?? entry.startedAt;
  const endedAt = input.endedAt ?? entry.endedAt;
  if ((input.startedAt || input.endedAt) && endedAt < startedAt) return { ok: false, error: "end_before_start" };
  const res = await prisma.timeEntry.updateMany({
    where: { id, endedAt: { not: null } },
    data: { startedAt, endedAt, activityTypeId: input.activityId, count: input.count, note: input.note },
  });
  return res.count === 1 ? { ok: true } : { ok: false, error: "notfound" };
}

export async function deleteEntry(id: string): Promise<TimeResult> {
  const res = await prisma.timeEntry.deleteMany({ where: { id } });
  return res.count === 1 ? { ok: true } : { ok: false, error: "notfound" };
}

// ───────────────────────── lista wpisów ─────────────────────────

export async function listEntries(requestedPage: number) {
  const total = await prisma.timeEntry.count({ where: { endedAt: { not: null } } });
  const pages = Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const entries = await prisma.timeEntry.findMany({
    where: { endedAt: { not: null } },
    orderBy: [{ startedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * ENTRIES_PAGE_SIZE,
    take: ENTRIES_PAGE_SIZE,
    select: { id: true, startedAt: true, endedAt: true, count: true, note: true, activityType: { select: { id: true, name: true } } },
  });
  return { total, page, pages, entries };
}

// ───────────────────────── podsumowania (liczone w zapytaniach) ─────────────────────────
// Wartości wyliczane nie są przechowywane (CLAUDE.md). Liczą się tylko zakończone wpisy z poprawnym czasem
// (endedAt >= startedAt); wpis przypisany jest do dnia/miesiąca swojego początku (czas warszawski).

const LOCAL_START = Prisma.sql`("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Warsaw'`;
const SECS = Prisma.sql`EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))`;
const VALID = Prisma.sql`"endedAt" IS NOT NULL AND "endedAt" >= "startedAt"`;

export async function periodTotals() {
  const rows = await prisma.$queryRaw<{ today: number; week: number; month: number }[]>`
    WITH e AS (SELECT ${LOCAL_START} AS ls, ${SECS} AS secs FROM "TimeEntry" WHERE ${VALID}),
         n AS (SELECT now() AT TIME ZONE 'Europe/Warsaw' AS n)
    SELECT COALESCE(SUM(secs) FILTER (WHERE ls >= date_trunc('day', n)), 0)::float8 AS today,
           COALESCE(SUM(secs) FILTER (WHERE ls >= date_trunc('week', n)), 0)::float8 AS week,
           COALESCE(SUM(secs) FILTER (WHERE ls >= date_trunc('month', n)), 0)::float8 AS month
    FROM e, n`;
  return rows[0] ?? { today: 0, week: 0, month: 0 };
}

export type PeriodRow = { period: string; entries: number; seconds: number };

export async function totalsByDay(limit = 14): Promise<PeriodRow[]> {
  return prisma.$queryRaw<PeriodRow[]>`
    SELECT to_char(${LOCAL_START}, 'YYYY-MM-DD') AS period, COUNT(*)::int AS entries, SUM(${SECS})::float8 AS seconds
    FROM "TimeEntry" WHERE ${VALID} GROUP BY 1 ORDER BY 1 DESC LIMIT ${limit}`;
}

export async function totalsByMonth(limit = 12): Promise<PeriodRow[]> {
  return prisma.$queryRaw<PeriodRow[]>`
    SELECT to_char(${LOCAL_START}, 'YYYY-MM') AS period, COUNT(*)::int AS entries, SUM(${SECS})::float8 AS seconds
    FROM "TimeEntry" WHERE ${VALID} GROUP BY 1 ORDER BY 1 DESC LIMIT ${limit}`;
}

export type ActivityRow = {
  name: string;
  entries: number;
  seconds: number;
  pieces: number;
  /** Średni czas na sztukę: tylko wpisy z liczbą > 0 (licznik i mianownik z tych samych wpisów). */
  secondsPerPiece: number | null;
};

export async function totalsByActivity(): Promise<ActivityRow[]> {
  return prisma.$queryRaw<ActivityRow[]>`
    SELECT COALESCE(a.name, '(bez czynności)') AS name,
           COUNT(*)::int AS entries,
           SUM(${SECS})::float8 AS seconds,
           COALESCE(SUM(t.count), 0)::int AS pieces,
           (SUM(${SECS}) FILTER (WHERE t.count > 0) / NULLIF(SUM(t.count) FILTER (WHERE t.count > 0), 0))::float8 AS "secondsPerPiece"
    FROM "TimeEntry" t LEFT JOIN "ActivityType" a ON a.id = t."activityTypeId"
    WHERE t."endedAt" IS NOT NULL AND t."endedAt" >= t."startedAt"
    GROUP BY a.name ORDER BY seconds DESC`;
}
