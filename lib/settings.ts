import { prisma } from "./prisma";

// Proste ustawienia aplikacji (tabela klucz → wartość).
export const KEYS = {
  intervalMinutes: "calendarSync.intervalMinutes",
  lastRunAt: "calendarSync.lastRunAt",
  manualRequestedAt: "calendarSync.manualRequestedAt",
  pullCursor: "calendarSync.pullCursor",
  lastError: "calendarSync.lastError",
} as const;

export const DEFAULT_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 1440;

async function get(key: string): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key } }))?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const asDate = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

export async function getSyncSettings() {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const interval = Number(m.get(KEYS.intervalMinutes));
  return {
    // poprawne: -1 (wyłączona), 0 (ręcznie) lub 1…MAX; wszystko inne → domyślne
    intervalMinutes: Number.isInteger(interval) && interval >= -1 && interval <= MAX_INTERVAL_MINUTES && m.has(KEYS.intervalMinutes) ? interval : DEFAULT_INTERVAL_MINUTES,
    lastRunAt: asDate(m.get(KEYS.lastRunAt) ?? null),
    manualRequestedAt: asDate(m.get(KEYS.manualRequestedAt) ?? null),
    pullCursor: asDate(m.get(KEYS.pullCursor) ?? null),
    lastError: m.get(KEYS.lastError) ?? null,
  };
}

/** Liczba minut: -1 = wyłączona, 0 = tylko ręcznie, 1…1440 = co tyle minut. Zwraca false dla niepoprawnej wartości. */
export async function setIntervalMinutes(n: number): Promise<boolean> {
  if (!Number.isInteger(n) || n < -1 || n > MAX_INTERVAL_MINUTES) return false;
  await setSetting(KEYS.intervalMinutes, String(n));
  return true;
}

export const requestManualSync = () => setSetting(KEYS.manualRequestedAt, new Date().toISOString());
export { get as getSetting };
