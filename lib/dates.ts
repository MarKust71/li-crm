// Daty wprowadzane w UI to czas warszawski (Europe/Warsaw); w bazie trzymamy UTC.
const TZ = "Europe/Warsaw";

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function offsetMs(utcMs: number): number {
  const p = Object.fromEntries(parts.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}

export function warsawToUtc(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  let t = wall - offsetMs(wall);
  t = wall - offsetMs(t);
  return new Date(t);
}

function validCalendar(y: number, mo: number, d: number, h: number, mi: number): boolean {
  const c = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return (
    y >= 1990 && y <= 2100 &&
    c.getUTCFullYear() === y && c.getUTCMonth() === mo - 1 && c.getUTCDate() === d &&
    h >= 0 && h < 24 && mi >= 0 && mi < 60
  );
}

/** "YYYY-MM-DD" (pole <input type="date">) → północ czasu warszawskiego albo null, gdy niepoprawne. */
export function parseDateInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m || !validCalendar(+m[1], +m[2], +m[3], 0, 0)) return null;
  return warsawToUtc(+m[1], +m[2], +m[3]);
}

/** "YYYY-MM-DDTHH:mm" (<input type="datetime-local">) → chwila w czasie warszawskim albo null. */
export function parseDateTimeInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m || !validCalendar(+m[1], +m[2], +m[3], +m[4], +m[5])) return null;
  return warsawToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

/** Dzisiejsza data w Warszawie jako "YYYY-MM-DD". */
export function todayWarsaw(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const inputFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

/** Chwila → "YYYY-MM-DDTHH:mm" w czasie warszawskim (wartość dla <input type="datetime-local">). */
export function toDateTimeInput(d: Date): string {
  return inputFmt.format(d).replace(" ", "T");
}
