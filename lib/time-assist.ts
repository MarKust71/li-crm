import { MAX_LOOKBACK_HOURS, decideTimeBar, type TimeBar } from "./time-assist-core";
import { prisma } from "./prisma";
import { getTimeSettings } from "./settings";
import { getRunningEntry } from "./time";

/** Akcje, które nie są "pracą" w CRM: czas pracy, ustawienia i czyszczenie dziennika. */
const NOT_WORK_PREFIXES = ["time.", "settings.", "log."];

export async function getTimeBar(now: Date, snooze: { idle: number | null; pause: number | null; start: number | null }) {
  const [settings, running, lastEnded] = await Promise.all([
    getTimeSettings(),
    getRunningEntry(),
    prisma.timeEntry.aggregate({ _max: { endedAt: true } }),
  ]);
  // ostatnie wznowienie trwającej sesji (jest najwyżej jedna trwająca, więc wystarczy najnowszy wpis po jej początku)
  const resumedAt = running && !running.pausedAt && running.pausedSeconds > 0
    ? (await prisma.activityLog.findFirst({ where: { action: "time.resumed", at: { gte: running.startedAt } }, orderBy: { at: "desc" }, select: { at: true } }))?.at ?? null
    : null;
  const lastEndedAt = lastEnded._max.endedAt ?? null;
  const lookback = new Date(now.getTime() - MAX_LOOKBACK_HOURS * 3_600_000);
  const since = running ? running.startedAt : new Date(Math.max(lastEndedAt?.getTime() ?? 0, lookback.getTime()));
  const rows = await prisma.activityLog.findMany({
    where: { source: "UI", at: { gte: since }, NOT: NOT_WORK_PREFIXES.map((p) => ({ action: { startsWith: p } })) },
    orderBy: { at: "desc" },
    take: 500,
    select: { at: true },
  });
  const bar: TimeBar = decideTimeBar({
    now,
    running: running ? { startedAt: running.startedAt, pausedAt: running.pausedAt, resumedAt } : null,
    idleMinutes: settings.idleMinutes,
    pauseMinutes: settings.pauseMinutes,
    suggestStart: settings.suggestStart,
    activityTimesDesc: rows.map((r) => r.at),
    lastEndedAt,
    snoozeIdleUntil: snooze.idle,
    snoozePauseUntil: snooze.pause,
    snoozeStartUntil: snooze.start,
  });
  return { bar, running };
}
