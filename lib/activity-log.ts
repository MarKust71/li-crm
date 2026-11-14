import type { ActivityLevel, ActivitySource, Prisma } from "@prisma/client";
import { addDays, parseDateInput } from "./dates";
import { prisma } from "./prisma";
import { getSetting, setSetting } from "./settings";

// Dziennik aktywności (/log). logActivity nigdy nie przerywa operacji, której dotyczy: błąd zapisu idzie tylko do konsoli.
// Nie zapisujemy haseł, kluczy API ani treści wiadomości; w opisach wystarczy imię kontaktu i wartości przed/po.

export const RETENTION_DAYS = 180;
export const LOG_PAGE_SIZE = 50;
export const SOURCES: ActivitySource[] = ["UI", "SYNC", "NOTIFY", "AUTH", "SYSTEM"];
export const LEVELS: ActivityLevel[] = ["INFO", "WARN", "ERROR"];

export type LogEntry = {
  source: ActivitySource;
  action: string;
  summary: string;
  level?: ActivityLevel;
  contactId?: string | null;
  details?: Prisma.InputJsonValue;
};

type Db = Pick<Prisma.TransactionClient, "activityLog">;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Zapis wpisu. Z `tx` trafia do tej samej transakcji co zmiana danych (wtedy błąd zapisu cofa całość, więc zapis jest prosty i pewny). */
export async function logActivity(entry: LogEntry, tx?: Db): Promise<void> {
  const data = {
    source: entry.source,
    level: entry.level ?? "INFO",
    action: clip(entry.action, 80),
    contactId: entry.contactId ?? null,
    summary: clip(entry.summary, 500),
    ...(entry.details !== undefined ? { details: entry.details } : {}),
  };
  if (tx) {
    await tx.activityLog.create({ data });
    return;
  }
  try {
    await prisma.activityLog.create({ data });
  } catch (e) {
    console.error("activity log:", e instanceof Error ? e.message : e);
  }
}

export type LogFilters = {
  source: ActivitySource | "";
  level: ActivityLevel | "";
  contact: string;
  q: string;
  from: string;
  to: string;
  page: number;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseLogFilters(params: Record<string, string | string[] | undefined>): LogFilters {
  const source = first(params.source) as ActivitySource;
  const level = first(params.level) as ActivityLevel;
  const from = first(params.from);
  const to = first(params.to);
  return {
    source: SOURCES.includes(source) ? source : "",
    level: LEVELS.includes(level) ? level : "",
    contact: first(params.contact).trim().slice(0, 64),
    q: first(params.q).trim().slice(0, 100),
    from: DATE_RE.test(from) ? from : "",
    to: DATE_RE.test(to) ? to : "",
    page: Math.max(1, Math.floor(Number(first(params.page))) || 1),
  };
}

function whereFor(f: LogFilters): Prisma.ActivityLogWhereInput {
  const and: Prisma.ActivityLogWhereInput[] = [];
  if (f.source) and.push({ source: f.source });
  if (f.level) and.push({ level: f.level });
  if (f.contact) and.push({ contactId: f.contact });
  if (f.q) and.push({ OR: [{ summary: { contains: f.q, mode: "insensitive" } }, { action: { contains: f.q, mode: "insensitive" } }] });
  if (f.from) and.push({ at: { gte: parseDateInput(f.from) ?? undefined } });
  if (f.to) and.push({ at: { lt: parseDateInput(addDays(f.to, 1)) ?? undefined } });
  return and.length ? { AND: and } : {};
}

export async function listActivity(f: LogFilters) {
  const where = whereFor(f);
  const total = await prisma.activityLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    skip: (page - 1) * LOG_PAGE_SIZE,
    take: LOG_PAGE_SIZE,
  });
  const ids = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  const contacts = ids.length ? await prisma.contact.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return { rows, total, pages, page, names: new Map(contacts.map((c) => [c.id, c.name])) };
}

export async function activityStats() {
  const [total, oldest] = await Promise.all([prisma.activityLog.count(), prisma.activityLog.findFirst({ orderBy: { at: "asc" }, select: { at: true } })]);
  return { total, oldest: oldest?.at ?? null };
}

/** Ręczne czyszczenie: `before` = wpisy starsze niż ta chwila, null = cały log. Zwraca liczbę usuniętych. */
export async function purgeActivity(before: Date | null): Promise<number> {
  const r = await prisma.activityLog.deleteMany({ where: before ? { at: { lt: before } } : {} });
  return r.count;
}

const LAST_PURGE_KEY = "activityLog.lastPurgeAt";

/** Automatyczna retencja: usuwa wpisy starsze niż 180 dni, najwyżej raz na dobę (wołane z endpointu n8n co minutę). */
export async function purgeExpired(now = new Date()): Promise<number> {
  const last = await getSetting(LAST_PURGE_KEY);
  if (last && now.getTime() - Date.parse(last) < 24 * 3_600_000) return 0;
  await setSetting(LAST_PURGE_KEY, now.toISOString());
  return purgeActivity(new Date(now.getTime() - RETENTION_DAYS * 24 * 3_600_000));
}

/** Imię kontaktu do opisu wpisu (puste, gdy kontaktu nie ma). */
export async function contactName(contactId: string, db: Pick<Prisma.TransactionClient, "contact"> = prisma): Promise<string> {
  return (await db.contact.findUnique({ where: { id: contactId }, select: { name: true } }))?.name ?? "(nieznany kontakt)";
}

const LOGIN_FAIL_LIMIT = 20; // na godzinę; dalsze próby (np. atak) nie zalewają tabeli

/** Nieudane logowanie z limitem wpisów: po przekroczeniu zapisujemy jedno ostrzeżenie i pomijamy resztę. */
export async function logLoginFailure(method: "password" | "passkey", reason: string, ip: string | null): Promise<void> {
  try {
    const recent = await prisma.activityLog.count({ where: { action: "auth.login_failed", at: { gte: new Date(Date.now() - 3_600_000) } } });
    if (recent > LOGIN_FAIL_LIMIT) return;
    if (recent === LOGIN_FAIL_LIMIT) {
      await logActivity({ source: "AUTH", level: "WARN", action: "auth.login_failed", summary: `Wiele nieudanych logowań (limit ${LOGIN_FAIL_LIMIT}/h): dalsze próby nie są zapisywane do końca godziny` });
      return;
    }
    await logActivity({
      source: "AUTH",
      level: "WARN",
      action: "auth.login_failed",
      summary: `Nieudane logowanie (${method === "password" ? "hasło" : "klucz dostępu"}): ${reason}`,
      details: { method, ip: ip ?? "unknown" },
    });
  } catch (e) {
    console.error("activity log:", e instanceof Error ? e.message : e);
  }
}
