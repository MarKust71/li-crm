type Ev = { type: string; occurredAt: Date; dateUnknown: boolean };

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });
const dayNum = (d: Date) => Date.parse(dayFmt.format(d) + "T00:00:00Z") / 86_400_000;


/**
 * Dopisek „(po X dniach)” dla zdarzenia ACCEPTED: dni kalendarzowe (czas warszawski) od ostatniego INVITE_SENT
 * sprzed przyjęcia. Brak dopisku, gdy nie ma zaproszenia albo ma ono nieznaną datę (`dateUnknown`, znacznik 2000-01-01).
 */
export function acceptDelaySuffix(accepted: Ev, events: Ev[]): string | null {
  if (accepted.type !== "ACCEPTED" || accepted.dateUnknown) return null;
  let last: Ev | null = null;
  for (const e of events) {
    if (e.type !== "INVITE_SENT" || e.occurredAt > accepted.occurredAt) continue;
    if (!last || e.occurredAt > last.occurredAt) last = e;
  }
  if (!last || last.dateUnknown) return null;
  const n = Math.round(dayNum(accepted.occurredAt) - dayNum(last.occurredAt));
  if (n < 0) return null;
  return `(po ${n} ${n === 1 ? "dniu" : "dniach"})`;
}
