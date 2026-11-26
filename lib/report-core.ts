import { addDays } from "./dates";
import { SITE, escapeHtml, link, warsawParts } from "./notify-core";

// Czysta logika dziennego raportu e-mail (bez bazy i sieci). Zapytania: lib/report.ts. Wysyła n8n przez SMTP
// (workflow "li-crm: powiadomienia Telegram", gałąź e-mail: wiadomości z channel = "email").

/** Okna zaległości w dniach kalendarzowych, liczone wstecz od raportowanego dnia (włącznie z nim). */
export const WAITING_QUESTION_DAYS = [3, 7, 30] as const;
export const WAITING_THANKS_DAYS = [7, 30] as const;
export const BALANCE_DAYS = 7;

export type ReportSettings = {
  /** Pusty = raport nie wychodzi. */
  recipient: string;
  /** -1 = wyłączony, 0…23 = godzina (czas warszawski), od której wysyłamy raport za poprzedni dzień. */
  sendHour: number;
};

export const DEFAULT_REPORT: ReportSettings = { recipient: "", sendHour: 0 };
export const MAX_RECIPIENT_LENGTH = 254;

/** Jeden adres e-mail (bez list i nazw wyświetlanych): "" dla pustego, null dla niepoprawnego. */
export function normalizeRecipient(input: string): string | null {
  const t = input.trim();
  if (!t) return "";
  return t.length <= MAX_RECIPIENT_LENGTH && /^[^\s@<>,;:"()]+@[^\s@<>,;:"()]+\.[^\s@<>,;:"()]+$/.test(t) ? t : null;
}

/** Który dzień raportować teraz: poprzedni, od ustawionej godziny. null = nic (wyłączony, brak adresu, za wcześnie). */
export function reportDayDue(settings: ReportSettings, now: Date): string | null {
  if (settings.sendHour < 0 || !settings.recipient) return null;
  const { date, hour } = warsawParts(now);
  return hour >= settings.sendHour ? addDays(date, -1) : null;
}

export type Waiting = { windows: { days: number; count: number }[]; total: number };

export type ReportData = {
  /** Raportowany dzień, "YYYY-MM-DD" (czas warszawski). */
  day: string;
  /** Liczby osób, nie zdarzeń. */
  invites: number;
  invitesAccepted: number;
  accepted: number;
  thanked: number;
  asked: number;
  balance: { thanked: number; asked: number };
  waitingForQuestion: Waiting;
  waitingForThanks: Waiting;
};

const weekday = (day: string) => new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", weekday: "long" }).format(new Date(`${day}T12:00:00Z`));
const shortDate = (day: string) => day.split("-").reverse().join(".");

const questions = (n: number) => (n === 1 ? "pytania" : "pytań");

export function goalLine(thanked: number, asked: number): string {
  if (thanked === 0 && asked === 0) return "Tego dnia nie było ani podziękowań, ani pytań o otwartość.";
  if (asked >= thanked) return `✅ Cel osiągnięty: pytań o otwartość (${asked}) jest co najmniej tyle, co podziękowań (${thanked}).`;
  const missing = thanked - asked;
  return `⚠️ Do wyrównania z podziękowaniami brakuje ${missing} ${questions(missing)} o otwartość.`;
}

export function reportSubject(d: ReportData): string {
  const missing = d.thanked - d.asked;
  const tail = d.thanked === 0 && d.asked === 0 ? "" : missing > 0 ? ` (brakuje ${missing} ${questions(missing)})` : " (cel osiągnięty)";
  return `li-crm: podsumowanie ${shortDate(d.day)}${tail}`;
}

type Line = { label: string; value: string };

function sections(d: ReportData) {
  const day: Line[] = [
    { label: "Zaproszenia", value: `${d.invites}, z tego już przyjęte: ${d.invitesAccepted}` },
    { label: "Wszystkie przyjęcia tego dnia", value: String(d.accepted) },
    { label: "Podziękowania", value: String(d.thanked) },
    { label: "Pytania o otwartość", value: String(d.asked) },
  ];
  const waiting = (w: Waiting) => [...w.windows.map((x) => `${x.days} dni: ${x.count}`), `razem: ${w.total}`].join(" · ");
  return {
    title: `Właśnie minął dzień ${shortDate(d.day)} (${weekday(d.day)}).`,
    day,
    goal: goalLine(d.thanked, d.asked),
    motto: "Dobrze byłoby, żeby pytań o otwartość było co najmniej tyle, co podziękowań.",
    balance: `Ostatnie ${BALANCE_DAYS} dni: pytania o otwartość ${d.balance.asked}, podziękowania ${d.balance.thanked}.`,
    waiting: [
      { title: "Czekają na pytanie o otwartość (podziękowano, jeszcze nie zapytano; wg daty podziękowania)", value: waiting(d.waitingForQuestion), url: `${SITE}/contacts?stage=THANKED` },
      { title: "Czekają na podziękowanie (przyjęli zaproszenie; wg daty przyjęcia)", value: waiting(d.waitingForThanks), url: `${SITE}/contacts?stage=ACCEPTED` },
    ],
  };
}

export function reportText(d: ReportData): string {
  const s = sections(d);
  return [
    s.title,
    "",
    ...s.day.map((l) => `- ${l.label}: ${l.value}`),
    "",
    s.goal,
    s.motto,
    s.balance,
    ...s.waiting.flatMap((w) => ["", w.title, w.value, w.url]),
    "",
    `Dashboard: ${SITE}/dashboard`,
  ].join("\n");
}

export function reportHtml(d: ReportData): string {
  const s = sections(d);
  const p = (t: string, style = "") => `<p style="margin:0 0 8px;${style}">${t}</p>`;
  return [
    `<!doctype html><html lang="pl"><body style="margin:0;padding:16px;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">`,
    `<div style="max-width:560px">`,
    p(`<b>${escapeHtml(s.title)}</b>`),
    `<ul style="margin:0 0 16px;padding-left:20px">${s.day.map((l) => `<li>${escapeHtml(l.label)}: <b>${escapeHtml(l.value)}</b></li>`).join("")}</ul>`,
    p(escapeHtml(s.goal)),
    p(escapeHtml(s.motto), "color:#555"),
    p(escapeHtml(s.balance), "color:#555;margin-bottom:20px"),
    ...s.waiting.map((w) => p(`${escapeHtml(w.title)}<br><b>${escapeHtml(w.value)}</b><br>${link("Otwórz listę", w.url)}`, "margin-bottom:16px")),
    p(link("Dashboard li-crm", `${SITE}/dashboard`)),
    `</div></body></html>`,
  ].join("");
}
