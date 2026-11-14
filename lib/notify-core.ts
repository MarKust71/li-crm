import type { EventType, ReminderKind } from "@prisma/client";

// Czysta logika powiadomień Telegram (bez bazy i sieci). Warstwa bazy: lib/notify.ts. Wysyła n8n (workflow "li-crm: powiadomienia Telegram").

export const SITE = "https://li-crm.mydmb.pl";
const MAX_LIST = 12; // pozycji na listę, żeby zmieścić się w limicie Telegrama (4096 znaków)
const MAX_TEXT = 3900;

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (text: string, url: string) => `<a href="${escapeHtml(url).replace(/"/g, "&quot;")}">${escapeHtml(text)}</a>`;

export type NotifySettings = {
  /** -1 = wyłączony, 0…23 = godzina (czas warszawski), od której wysyłamy poranny przegląd. */
  digestHour: number;
  /** 0 = wyłączone; N = przypomnienie o spotkaniu N minut wcześniej. */
  meetingLeadMinutes: number;
  errorAlerts: boolean;
};

export const DEFAULT_NOTIFY: NotifySettings = { digestHour: 9, meetingLeadMinutes: 30, errorAlerts: true };

export function warsawParts(d: Date): { date: string; hour: number; minute: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export const hhmm = (d: Date) => {
  const { hour, minute } = warsawParts(d);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

/** Poranny przegląd: od ustawionej godziny, raz dziennie (kolejny tick po wysłaniu go nie powtarza). */
export function digestDue(input: { digestHour: number; now: Date; alreadySentToday: boolean }): boolean {
  if (input.digestHour < 0 || input.alreadySentToday) return false;
  return warsawParts(input.now).hour >= input.digestHour;
}

/** Spotkanie w oknie (teraz, teraz + lead]. */
export function meetingSoon(scheduledAt: Date, now: Date, leadMinutes: number): boolean {
  if (leadMinutes <= 0) return false;
  const ms = scheduledAt.getTime() - now.getTime();
  return ms > 0 && ms <= leadMinutes * 60_000;
}

const MEETING_LABEL: Partial<Record<EventType, string>> = { BOM_SCHEDULED: "BOM", FOLLOW_UP: "FU" };
export const meetingLabel = (t: EventType) => MEETING_LABEL[t] ?? "Spotkanie";

type Person = { name: string; profileUrl: string };
export type DigestReminder = Person & { kind: ReminderKind; note: string | null };
export type DigestMeeting = Person & { type: EventType; time: string };

function cap(lines: string[], more: (n: number) => string): string[] {
  if (lines.length <= MAX_LIST) return lines;
  return [...lines.slice(0, MAX_LIST), more(lines.length - MAX_LIST)];
}

const trim = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + "…" : s);

export function digestText(input: { dateLabel: string; reminders: DigestReminder[]; overdueCount: number; meetings: DigestMeeting[] }): string {
  const { reminders, meetings, overdueCount } = input;
  const head = `<b>Dziś, ${escapeHtml(input.dateLabel)}</b>`;
  if (reminders.length === 0 && meetings.length === 0) {
    return `${head}\nNic na dziś w kalendarzu li-crm.${overdueCount ? `\nZaległe przypomnienia: ${overdueCount} (${link("otwórz", `${SITE}/today`)}).` : ""}`;
  }
  const parts = [head];
  if (meetings.length) {
    parts.push("", "<b>Spotkania</b>", ...cap(meetings.map((m) => `• ${m.time} ${meetingLabel(m.type)}: ${link(m.name, m.profileUrl)}`), (n) => `… i ${n} więcej`));
  }
  if (reminders.length) {
    parts.push("", `<b>Przypomnienia (${reminders.length})</b>`, ...cap(
      reminders.map((r) => `• ${link(r.name, r.profileUrl)}${r.kind === "RECONNECT" ? " (re-connect)" : ""}${r.note ? ` — ${escapeHtml(r.note.length > 80 ? r.note.slice(0, 79) + "…" : r.note)}` : ""}`),
      (n) => `… i ${n} więcej`,
    ));
  }
  if (overdueCount > 0) parts.push("", `Zaległe: ${overdueCount}`);
  parts.push("", link("Otwórz li-crm", `${SITE}/today`));
  return trim(parts.join("\n"));
}

export function meetingSoonText(input: { type: EventType; name: string; profileUrl: string; time: string; minutesLeft: number }): string {
  const m = Math.max(1, Math.round(input.minutesLeft));
  return `⏰ Za ${m} min (${input.time}): ${meetingLabel(input.type)} z ${link(input.name, input.profileUrl)}`;
}

export function errorText(input: { failed: number; samples: string[]; syncError: string | null }): string {
  const lines = ["⚠️ <b>li-crm: synchronizacja z kalendarzem</b>"];
  if (input.failed > 0) lines.push(`Nie udało się zsynchronizować pozycji: ${input.failed} (po 5 próbach przestaje ponawiać).`);
  for (const s of input.samples.slice(0, 3)) lines.push(`• ${escapeHtml(s.slice(0, 200))}`);
  if (input.syncError) lines.push(`Ostatni błąd odczytu: ${escapeHtml(input.syncError.slice(0, 200))}`);
  lines.push("", link("Ustawienia", `${SITE}/settings`));
  return trim(lines.join("\n"));
}

export const testText = () => "✅ li-crm: wiadomość testowa. Powiadomienia Telegram działają.";

/** Krótka sygnatura zestawu błędów (do deduplikacji: ten sam zestaw → jedna wiadomość na dobę). */
export function errorSignature(parts: string[]): string {
  let h = 5381;
  const s = [...parts].sort().join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const dateLabelPl = (d: Date) =>
  new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", weekday: "long", day: "numeric", month: "long" }).format(d);
