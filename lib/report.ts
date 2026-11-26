import { Prisma } from "@prisma/client";
import { addDays, parseDateInput, todayWarsaw } from "./dates";
import { prisma } from "./prisma";
import { BALANCE_DAYS, WAITING_QUESTION_DAYS, WAITING_THANKS_DAYS, type ReportData, type Waiting } from "./report-core";

// Zapytania dziennego raportu e-mail. Liczymy osoby, nie zdarzenia; zdarzenia z dateUnknown pomijamy wszędzie, gdzie liczy się data.

const midnight = (day: string) => parseDateInput(day)!;
const within = (from: Date, to: Date) => Prisma.sql`e."dateUnknown" = false AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to}`;

/** Zaproszenia jak na dashboardzie: tylko wysłane (OUTBOUND, INVITE_SENT); przyjęte z nich = przyjęcie w tym samym dniu. */
async function dayCounts(from: Date, to: Date) {
  const [r] = await prisma.$queryRaw<{ invites: number; invites_accepted: number; accepted: number }[]>`
    WITH p AS (
      SELECT e."contactId",
        bool_or(e."type"::text = 'INVITE_SENT') AS inv,
        bool_or(e."type"::text = 'ACCEPTED') AS acc
      FROM "ContactEvent" e JOIN "Contact" c ON c."id" = e."contactId"
      WHERE c."direction"::text = 'OUTBOUND' AND e."type"::text IN ('INVITE_SENT', 'ACCEPTED') AND ${within(from, to)}
      GROUP BY e."contactId")
    SELECT COUNT(*) FILTER (WHERE inv)::int AS invites,
           COUNT(*) FILTER (WHERE inv AND acc)::int AS invites_accepted,
           COUNT(*) FILTER (WHERE acc)::int AS accepted
    FROM p`;
  return { invites: r.invites, invitesAccepted: r.invites_accepted, accepted: r.accepted };
}

/** Podziękowania i pytania: wszystkie kontakty (to moja praca, niezależnie od kierunku zaproszenia). */
async function activity(from: Date, to: Date) {
  const [r] = await prisma.$queryRaw<{ thanked: number; asked: number }[]>`
    SELECT COUNT(DISTINCT e."contactId") FILTER (WHERE e."type"::text = 'THANKS_SENT')::int AS thanked,
           COUNT(DISTINCT e."contactId") FILTER (WHERE e."type"::text = 'ASKED_OPEN')::int AS asked
    FROM "ContactEvent" e
    WHERE e."type"::text IN ('THANKS_SENT', 'ASKED_OPEN') AND ${within(from, to)}`;
  return r;
}

/**
 * Zaległości wg stanu na teraz: niezarchiwizowane kontakty na danym etapie (czyli bez żadnego dalszego kroku).
 * Okna liczone od ostatniego zdarzenia `type`; kontakty bez znanej daty są tylko w "razem".
 */
async function waiting(stage: "THANKED" | "ACCEPTED", type: "THANKS_SENT" | "ACCEPTED", days: readonly number[], day: string, to: Date): Promise<Waiting> {
  const rows = await prisma.$queryRaw<{ at: Date | null }[]>`
    SELECT MAX(e."occurredAt") FILTER (WHERE e."dateUnknown" = false) AS at
    FROM "Contact" c LEFT JOIN "ContactEvent" e ON e."contactId" = c."id" AND e."type"::text = ${type}
    WHERE c."stage"::text = ${stage} AND c."archivedAt" IS NULL
    GROUP BY c."id"`;
  return {
    total: rows.length,
    windows: days.map((n) => {
      const from = midnight(addDays(day, -(n - 1)));
      return { days: n, count: rows.filter((r) => r.at && r.at >= from && r.at < to).length };
    }),
  };
}

/** Dane raportu za jeden dzień kalendarzowy czasu warszawskiego (domyślnie wczoraj). */
export async function getReportData(day: string = addDays(todayWarsaw(), -1)): Promise<ReportData> {
  const from = midnight(day);
  const to = midnight(addDays(day, 1));
  const [counts, today, balance, waitingForQuestion, waitingForThanks] = await Promise.all([
    dayCounts(from, to),
    activity(from, to),
    activity(midnight(addDays(day, -(BALANCE_DAYS - 1))), to),
    waiting("THANKED", "THANKS_SENT", WAITING_QUESTION_DAYS, day, to),
    waiting("ACCEPTED", "ACCEPTED", WAITING_THANKS_DAYS, day, to),
  ]);
  return { day, ...counts, thanked: today.thanked, asked: today.asked, balance, waitingForQuestion, waitingForThanks };
}
