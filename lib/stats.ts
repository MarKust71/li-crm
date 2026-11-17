import { Prisma } from "@prisma/client";
import type { Direction } from "@prisma/client";
import { connection } from "next/server";
import { prisma } from "./prisma";
import { todayWarsaw, warsawToUtc } from "./dates";
import {
  SERIES_STEPS, STEPS, TAG_STEPS, TIMING_PAIRS, buckets, pickGranularity, resolvePeriod,
  DASH_WINDOWS, dashboardPeriods,
  type DashMode, type DashWindow, type Gran, type Period, type StepKey,
} from "./stats-core";

// Statystyki liczone w zapytaniach z danych (CLAUDE.md: wartości liczone nie są przechowywane).
// Zdarzenia z dateUnknown = true pomijamy wszędzie, gdzie liczy się czas (okres, szereg, czas reakcji).

export type StatsFilters = { period?: string; from?: string; to?: string; direction?: string; tag?: string; gran?: string };

const TZ = "Europe/Warsaw";

/** Kroki jako tabela (klucz, typ zdarzenia) do łączenia w zapytaniach. */
const STEP_VALUES = Prisma.join(STEPS.flatMap((s) => s.types.map((t) => Prisma.sql`(${s.key}, ${t})`)));

/** Północ czasu warszawskiego dla dnia YYYY-MM-DD (zdarzenia dzienne są zapisane jako taki moment). */
function warsawMidnight(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return warsawToUtc(y, m, d);
}

const inPeriod = (col: Prisma.Sql, p: Period) => {
  const from = p.from ? warsawMidnight(p.from) : null;
  const to = warsawMidnight(p.to);
  return from ? Prisma.sql`${col} >= ${from} AND ${col} < ${to}` : Prisma.sql`${col} < ${to}`;
};

function contactFilter(direction: Direction | null, tag: string | null): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (direction) parts.push(Prisma.sql`c."direction"::text = ${direction}`);
  if (tag) parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ContactTag" ct JOIN "Tag" t ON t."id" = ct."tagId" WHERE ct."contactId" = c."id" AND t."name" = ${tag})`);
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}` : Prisma.empty;
}

/** Kohorta: kontakty z pierwszym zaproszeniem (z datą) w okresie. */
function cohortCte(p: Period, cf: Prisma.Sql) {
  return Prisma.sql`cohort AS (
    SELECT e."contactId", MIN(e."occurredAt") AS at
    FROM "ContactEvent" e JOIN "Contact" c ON c."id" = e."contactId"
    WHERE e."type"::text IN ('INVITE_SENT', 'INVITE_RECEIVED') AND e."dateUnknown" = false ${cf}
    GROUP BY e."contactId"
    HAVING ${inPeriod(Prisma.sql`MIN(e."occurredAt")`, p)}
  )`;
}

export type StepStat = { key: StepKey; periodContacts: number; periodEvents: number; cohort: number };
export type SeriesRow = { bucket: string; counts: Record<string, number> };
export type TimingRow = { from: StepKey; to: StepKey; n: number; avgDays: number | null; medianDays: number | null };
export type TagRow = { tag: string; cohort: number; counts: Record<string, number> };

export type Stats = {
  period: Period;
  gran: Gran;
  direction: Direction | "";
  tag: string;
  tags: string[];
  cohortSize: number;
  steps: StepStat[];
  series: SeriesRow[];
  timings: TimingRow[];
  byTag: TagRow[];
  unknownDateEvents: number;
};

export async function getStats(f: StatsFilters): Promise<Stats> {
  await connection(); // "dziś" zależy od żądania (cacheComponents)
  const today = todayWarsaw();
  const period = resolvePeriod({ period: f.period, from: f.from, to: f.to }, today);
  const direction = f.direction === "OUTBOUND" || f.direction === "INBOUND" ? f.direction : null;
  const tag = (f.tag ?? "").slice(0, 200) || null;
  const cf = contactFilter(direction, tag);
  const cfNoTag = contactFilter(direction, null);

  const earliestRow = await prisma.$queryRaw<{ d: string | null }[]>`
    SELECT to_char(MIN(e."occurredAt") AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS d
    FROM "ContactEvent" e JOIN "Contact" c ON c."id" = e."contactId" WHERE e."dateUnknown" = false ${cf}`;
  const earliest = earliestRow[0]?.d ?? null;
  const gran = pickGranularity(period, f.gran, earliest);

  const periodRows = prisma.$queryRaw<{ key: StepKey; contacts: number; events: number }[]>`
    SELECT s.key, COUNT(DISTINCT e."contactId")::int AS contacts, COUNT(*)::int AS events
    FROM (VALUES ${STEP_VALUES}) AS s(key, type)
    JOIN "ContactEvent" e ON e."type"::text = s.type
    JOIN "Contact" c ON c."id" = e."contactId"
    WHERE e."dateUnknown" = false AND ${inPeriod(Prisma.sql`e."occurredAt"`, period)} ${cf}
    GROUP BY s.key`;

  const cohortRows = prisma.$queryRaw<{ key: StepKey | "_size"; contacts: number }[]>`
    WITH ${cohortCte(period, cf)}
    SELECT '_size' AS key, COUNT(*)::int AS contacts FROM cohort
    UNION ALL
    SELECT s.key, COUNT(DISTINCT e."contactId")::int
    FROM cohort JOIN "ContactEvent" e ON e."contactId" = cohort."contactId"
    JOIN (VALUES ${STEP_VALUES}) AS s(key, type) ON e."type"::text = s.type
    GROUP BY s.key`;

  const seriesKeys = Prisma.join(SERIES_STEPS.map((k) => Prisma.sql`${k}`));
  const seriesRows = prisma.$queryRaw<{ bucket: string; key: StepKey; contacts: number }[]>`
    SELECT to_char(date_trunc(${gran}, e."occurredAt" AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS bucket, s.key,
           COUNT(DISTINCT e."contactId")::int AS contacts
    FROM (VALUES ${STEP_VALUES}) AS s(key, type)
    JOIN "ContactEvent" e ON e."type"::text = s.type
    JOIN "Contact" c ON c."id" = e."contactId"
    WHERE s.key IN (${seriesKeys}) AND e."dateUnknown" = false AND ${inPeriod(Prisma.sql`e."occurredAt"`, period)} ${cf}
    GROUP BY 1, 2`;

  const pairs = Prisma.join(TIMING_PAIRS.map(([a, b]) => Prisma.sql`(${a}, ${b})`));
  const timingRows = prisma.$queryRaw<{ a: StepKey; b: StepKey; n: number; avg: number | null; median: number | null }[]>`
    WITH f AS (
      SELECT e."contactId", s.key, MIN(e."occurredAt") AS at
      FROM (VALUES ${STEP_VALUES}) AS s(key, type)
      JOIN "ContactEvent" e ON e."type"::text = s.type
      JOIN "Contact" c ON c."id" = e."contactId"
      WHERE e."dateUnknown" = false ${cf}
      GROUP BY e."contactId", s.key)
    SELECT p.a, p.b, COUNT(*)::int AS n,
           AVG(EXTRACT(EPOCH FROM (fb.at - fa.at)) / 86400)::float8 AS avg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fb.at - fa.at)) / 86400)::float8 AS median
    FROM (VALUES ${pairs}) AS p(a, b)
    JOIN f fa ON fa.key = p.a
    JOIN f fb ON fb."contactId" = fa."contactId" AND fb.key = p.b
    WHERE fb.at >= fa.at AND ${inPeriod(Prisma.sql`fa.at`, period)}
    GROUP BY p.a, p.b`;

  const tagKeys = Prisma.join(TAG_STEPS.map((k) => Prisma.sql`${k}`));
  const tagRows = prisma.$queryRaw<{ tag: string; key: StepKey | "_size"; contacts: number }[]>`
    WITH ${cohortCte(period, cfNoTag)}
    SELECT t."name" AS tag, '_size' AS key, COUNT(DISTINCT co."contactId")::int AS contacts
    FROM cohort co JOIN "ContactTag" ct ON ct."contactId" = co."contactId" JOIN "Tag" t ON t."id" = ct."tagId"
    GROUP BY t."name"
    UNION ALL
    SELECT t."name", s.key, COUNT(DISTINCT co."contactId")::int
    FROM cohort co JOIN "ContactTag" ct ON ct."contactId" = co."contactId" JOIN "Tag" t ON t."id" = ct."tagId"
    JOIN "ContactEvent" e ON e."contactId" = co."contactId"
    JOIN (VALUES ${STEP_VALUES}) AS s(key, type) ON e."type"::text = s.type
    WHERE s.key IN (${tagKeys})
    GROUP BY t."name", s.key`;

  const [pr, cr, sr, tr, tgr, tags, unknown] = await Promise.all([
    periodRows, cohortRows, seriesRows, timingRows, tagRows,
    prisma.tag.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.contactEvent.count({ where: { dateUnknown: true } }),
  ]);

  const periodMap = new Map(pr.map((r) => [r.key, r]));
  const cohortMap = new Map(cr.map((r) => [r.key, r.contacts]));
  const steps: StepStat[] = STEPS.map((s) => ({
    key: s.key,
    periodContacts: periodMap.get(s.key)?.contacts ?? 0,
    periodEvents: periodMap.get(s.key)?.events ?? 0,
    cohort: cohortMap.get(s.key) ?? 0,
  }));

  // szereg: wszystkie przedziały okresu (także puste), najnowsze na górze
  const from = period.from ?? earliest ?? period.to;
  const seriesMap = new Map<string, Record<string, number>>();
  for (const r of sr) seriesMap.set(r.bucket, { ...(seriesMap.get(r.bucket) ?? {}), [r.key]: r.contacts });
  // "cały okres" może sięgać lat wstecz (stare połączenia): wtedy pokazujemy tylko przedziały z danymi
  const series = buckets(from, period.to, gran)
    .filter((b) => period.from !== null || seriesMap.has(b))
    .map((b) => ({ bucket: b, counts: seriesMap.get(b) ?? {} }))
    .reverse();

  const timings: TimingRow[] = TIMING_PAIRS.map(([a, b]) => {
    const r = tr.find((x) => x.a === a && x.b === b);
    return { from: a, to: b, n: r?.n ?? 0, avgDays: r?.avg ?? null, medianDays: r?.median ?? null };
  });

  const tagMap = new Map<string, TagRow>();
  for (const r of tgr) {
    const row = tagMap.get(r.tag) ?? { tag: r.tag, cohort: 0, counts: {} };
    if (r.key === "_size") row.cohort = r.contacts; else row.counts[r.key] = r.contacts;
    tagMap.set(r.tag, row);
  }
  const byTag = [...tagMap.values()].sort((x, y) => y.cohort - x.cohort || x.tag.localeCompare(y.tag, "pl"));

  return {
    period, gran, direction: direction ?? "", tag: tag ?? "", tags: tags.map((t) => t.name),
    cohortSize: cohortMap.get("_size") ?? 0, steps, series, timings, byTag, unknownDateEvents: unknown,
  };
}


// ───────────────────────── dashboard ─────────────────────────

export type DashCell = { invites: number; accepted: number; asked: number };
export type Dashboard = { mode: DashMode; cohort: boolean; today: string; windows: Record<DashWindow, { period: Period; cell: DashCell }> };

/**
 * Dashboard: tylko zaproszenia wysłane (kontakty OUTBOUND, INVITE_SENT), bez tagów, osoby a nie zdarzenia.
 * Bez kohorty: każdy krok liczony niezależnie w okresie. Ścisła kohorta: przyjęcie wymaga zaproszenia w tym samym okresie,
 * pytanie o rozmowę wymaga przyjęcia i zaproszenia w tym samym okresie (więc procenty nie przekraczają 100%).
 */
export async function getDashboard(mode: DashMode, cohort: boolean): Promise<Dashboard> {
  await connection();
  const today = todayWarsaw();
  const periods = dashboardPeriods(today, mode);
  const rows = await Promise.all(
    DASH_WINDOWS.map((w) => prisma.$queryRaw<{ invites: number; accepted: number; accepted_c: number; asked: number; asked_c: number }[]>`
      WITH p AS (
        SELECT e."contactId",
          bool_or(e."type"::text = 'INVITE_SENT') AS inv,
          bool_or(e."type"::text = 'ACCEPTED') AS acc,
          bool_or(e."type"::text = 'ASKED_OPEN') AS ask
        FROM "ContactEvent" e JOIN "Contact" c ON c."id" = e."contactId"
        WHERE c."direction"::text = 'OUTBOUND' AND e."dateUnknown" = false
          AND e."type"::text IN ('INVITE_SENT', 'ACCEPTED', 'ASKED_OPEN')
          AND ${inPeriod(Prisma.sql`e."occurredAt"`, periods[w])}
        GROUP BY e."contactId")
      SELECT COUNT(*) FILTER (WHERE inv)::int AS invites,
             COUNT(*) FILTER (WHERE acc)::int AS accepted,
             COUNT(*) FILTER (WHERE acc AND inv)::int AS accepted_c,
             COUNT(*) FILTER (WHERE ask)::int AS asked,
             COUNT(*) FILTER (WHERE ask AND acc AND inv)::int AS asked_c
      FROM p`),
  );
  const windows = Object.fromEntries(
    DASH_WINDOWS.map((w, i) => {
      const r = rows[i][0];
      const cell: DashCell = cohort
        ? { invites: r.invites, accepted: r.accepted_c, asked: r.asked_c }
        : { invites: r.invites, accepted: r.accepted, asked: r.asked };
      return [w, { period: periods[w], cell }];
    }),
  ) as Dashboard["windows"];
  return { mode, cohort, today, windows };
}
