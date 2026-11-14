// Czyste reguły podpowiedzi przy rejestrowaniu czasu pracy (bez bazy, żeby dało się je testować).

export const START_WINDOW_MIN = 15; // aktywność nowsza niż tyle minut = "teraz pracuję"
export const MAX_LOOKBACK_HOURS = 12; // nie cofamy początku sesji dalej niż tyle godzin

export type TimeBar =
  | { kind: "idle"; lastActivityAt: Date; startedAt: Date }
  | { kind: "start"; from: Date }
  | null;

/** Początek ostatniej serii aktywności: od najnowszej wstecz, dopóki przerwa między wpisami nie przekracza `gapMs`. `timesDesc` malejąco. */
export function burstStart(timesDesc: Date[], gapMs: number): Date | null {
  if (timesDesc.length === 0) return null;
  let start = timesDesc[0];
  for (let i = 1; i < timesDesc.length; i++) {
    if (start.getTime() - timesDesc[i].getTime() > gapMs) break;
    start = timesDesc[i];
  }
  return start;
}

export type DecideInput = {
  now: Date;
  /** Trwająca sesja albo null. */
  running: { startedAt: Date } | null;
  idleMinutes: number;
  suggestStart: boolean;
  /** Czasy aktywności użytkownika (bez czasu pracy, ustawień i dziennika), malejąco. */
  activityTimesDesc: Date[];
  /** Koniec ostatniej zakończonej sesji. */
  lastEndedAt: Date | null;
  snoozeIdleUntil: number | null;
  snoozeStartUntil: number | null;
};

export function decideTimeBar(i: DecideInput): TimeBar {
  const now = i.now.getTime();
  if (i.running) {
    if (i.idleMinutes <= 0 || (i.snoozeIdleUntil ?? 0) > now) return null;
    const startedAt = i.running.startedAt;
    const newest = i.activityTimesDesc[0];
    const last = newest && newest.getTime() >= startedAt.getTime() ? newest : startedAt;
    return now - last.getTime() >= i.idleMinutes * 60_000 ? { kind: "idle", lastActivityAt: last, startedAt } : null;
  }
  if (!i.suggestStart || (i.snoozeStartUntil ?? 0) > now) return null;
  const candidates = i.activityTimesDesc.filter((t) => !i.lastEndedAt || t.getTime() > i.lastEndedAt.getTime());
  const newest = candidates[0];
  if (!newest || now - newest.getTime() > START_WINDOW_MIN * 60_000) return null;
  const gap = (i.idleMinutes > 0 ? i.idleMinutes : 120) * 60_000;
  const from = burstStart(candidates, gap);
  return from ? { kind: "start", from } : null;
}
