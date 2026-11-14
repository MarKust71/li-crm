import { DEFAULT_NOTIFY, type NotifySettings } from "./notify-core";
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

// ───────────────────────── powiadomienia Telegram ─────────────────────────

export const NOTIFY_KEYS = {
  digestHour: "notify.digestHour",
  meetingLeadMinutes: "notify.meetingLeadMinutes",
  errorAlerts: "notify.errorAlerts",
  testRequestedAt: "notify.testRequestedAt",
} as const;

export const MAX_LEAD_MINUTES = 720;

const intIn = (v: string | undefined, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export async function getNotifySettings(): Promise<NotifySettings & { testRequestedAt: Date | null }> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(NOTIFY_KEYS) } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    digestHour: intIn(m.get(NOTIFY_KEYS.digestHour), -1, 23, DEFAULT_NOTIFY.digestHour),
    meetingLeadMinutes: intIn(m.get(NOTIFY_KEYS.meetingLeadMinutes), 0, MAX_LEAD_MINUTES, DEFAULT_NOTIFY.meetingLeadMinutes),
    errorAlerts: m.has(NOTIFY_KEYS.errorAlerts) ? m.get(NOTIFY_KEYS.errorAlerts) === "1" : DEFAULT_NOTIFY.errorAlerts,
    testRequestedAt: asDate(m.get(NOTIFY_KEYS.testRequestedAt) ?? null),
  };
}

/** Zwraca false, gdy któraś wartość jest poza zakresem (nic wtedy nie zapisuje). */
export async function setNotifySettings(input: NotifySettings): Promise<boolean> {
  const { digestHour: h, meetingLeadMinutes: l } = input;
  if (!Number.isInteger(h) || h < -1 || h > 23 || !Number.isInteger(l) || l < 0 || l > MAX_LEAD_MINUTES) return false;
  await setSetting(NOTIFY_KEYS.digestHour, String(h));
  await setSetting(NOTIFY_KEYS.meetingLeadMinutes, String(l));
  await setSetting(NOTIFY_KEYS.errorAlerts, input.errorAlerts ? "1" : "0");
  return true;
}

export const requestNotifyTest = () => setSetting(NOTIFY_KEYS.testRequestedAt, new Date().toISOString());
