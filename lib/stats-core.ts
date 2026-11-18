import type { EventType } from "@prisma/client";
import { addDays, parseDateInput } from "./dates";

// Czysta logika statystyk (bez bazy): definicje kroków lejka, okresy, przedziały czasu. Zapytania: lib/stats.ts.

export type StepKey =
  | "invite" | "accepted" | "thanked" | "asked" | "responded" | "open" | "notNow" | "notOpen"
  | "proposed" | "scheduled" | "confirmed" | "canceled" | "completed" | "yes" | "no";

export type Step = { key: StepKey; label: string; types: EventType[]; parent: StepKey | null };

/** Kroki lejka w kolejności. `parent` = poprzedni krok, względem którego liczymy konwersję. */
export const STEPS: Step[] = [
  { key: "invite", label: "Zaproszenia", types: ["INVITE_SENT", "INVITE_RECEIVED"], parent: null },
  { key: "accepted", label: "Zaproszenie przyjęte", types: ["ACCEPTED"], parent: "invite" },
  { key: "thanked", label: "Podziękowano", types: ["THANKS_SENT"], parent: "accepted" },
  { key: "asked", label: "Zapytano o rozmowę", types: ["ASKED_OPEN"], parent: "accepted" },
  { key: "responded", label: "Reakcja na pytanie", types: ["ASKED_OPEN_RESPONSE"], parent: "asked" },
  { key: "open", label: "Chce rozmawiać", types: ["OPEN_TO_TALK"], parent: "asked" },
  { key: "notNow", label: "Nie teraz", types: ["NOT_NOW"], parent: "asked" },
  { key: "notOpen", label: "Nie chce rozmawiać", types: ["NOT_INTERESTED"], parent: "asked" },
  { key: "proposed", label: "Zaproponowano BOM", types: ["BOM_PROPOSED"], parent: "open" },
  { key: "scheduled", label: "BOM umówiony", types: ["BOM_SCHEDULED"], parent: "proposed" },
  { key: "confirmed", label: "BOM potwierdzony", types: ["BOM_CONFIRMED"], parent: "scheduled" },
  { key: "canceled", label: "BOM odwołany", types: ["BOM_CANCELED"], parent: "scheduled" },
  { key: "completed", label: "BOM odbyty", types: ["BOM_COMPLETED"], parent: "scheduled" },
  { key: "yes", label: "Decyzja: tak", types: ["DECISION_YES"], parent: "completed" },
  { key: "no", label: "Decyzja: nie", types: ["DECISION_NO"], parent: "completed" },
];

export const STEP_LABEL = Object.fromEntries(STEPS.map((s) => [s.key, s.label])) as Record<StepKey, string>;

/** Kolumny szeregu czasowego (jak w arkuszu „Summary”). */
export const SERIES_STEPS: StepKey[] = ["invite", "accepted", "asked", "open", "scheduled", "completed"];

/** Pary kroków, dla których liczymy czas reakcji (od pierwszego A do pierwszego B). */
export const TIMING_PAIRS: [StepKey, StepKey][] = [
  ["invite", "accepted"],
  ["accepted", "asked"],
  ["asked", "responded"],
  ["asked", "open"],
  ["proposed", "scheduled"],
  ["scheduled", "completed"],
];

/** Kolumny tabeli segmentów (tagów). */
export const TAG_STEPS: StepKey[] = ["accepted", "asked", "open", "scheduled", "completed"];

// ───────────────────────── okres ─────────────────────────

export const PRESETS = ["7", "30", "90", "365", "all"] as const;
export type Preset = (typeof PRESETS)[number] | "custom";
export type Gran = "day" | "week" | "month";

export type Period = {
  preset: Preset;
  /** Pierwszy dzień okresu (włącznie), null = od początku danych. */
  from: string | null;
  /** Dzień po ostatnim dniu okresu (wyłącznie). */
  to: string;
  label: string;
};

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366 * 20;

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

export function resolvePeriod(input: { period?: string; from?: string; to?: string }, today: string): Period {
  const tomorrow = addDays(today, 1);
  if (input.period === "custom" || (!input.period && (input.from || input.to))) {
    let from = input.from && RE_DATE.test(input.from) && parseDateInput(input.from) ? input.from : null;
    let toIncl = input.to && RE_DATE.test(input.to) && parseDateInput(input.to) ? input.to : today;
    if (from && dayNum(from) > dayNum(toIncl)) [from, toIncl] = [toIncl, from];
    if (from && dayNum(toIncl) - dayNum(from) > MAX_DAYS) from = addDays(toIncl, -MAX_DAYS);
    return { preset: "custom", from, to: addDays(toIncl, 1), label: `${from ?? "początek"} – ${toIncl}` };
  }
  const preset = (PRESETS as readonly string[]).includes(input.period ?? "") ? (input.period as (typeof PRESETS)[number]) : "30";
  if (preset === "all") return { preset, from: null, to: tomorrow, label: "cały okres" };
  const n = Number(preset);
  return { preset, from: addDays(today, 1 - n), to: tomorrow, label: `ostatnie ${n} dni` };
}

// ───────────────────────── dashboard ─────────────────────────

export type DashWindow = "today" | "week" | "month" | "year" | "fiscal" | "all";
/** rolling = wstecz od dziś (7/30/365 dni); calendar = od poniedziałku / 1. dnia miesiąca / 1 stycznia do dziś. */
export type DashMode = "rolling" | "calendar";

/** Początek roku biznesowego: 1 września (bieżącego roku, a od stycznia do sierpnia poprzedniego). */
export const FISCAL_START_MONTH = 9;

export const DASH_LABEL: Record<DashMode, Partial<Record<DashWindow, string>>> = {
  rolling: { today: "Dziś", week: "Ostatnie 7 dni", month: "Ostatnie 30 dni", year: "Ostatnie 365 dni", fiscal: "Od początku roku biznesowego", all: "Cały okres" },
  calendar: { today: "Dziś", week: "Ten tydzień", month: "Ten miesiąc", year: "Ten rok", fiscal: "Ten rok biznesowy", all: "Cały okres" },
};

export type DashPeriod = { key: DashWindow; period: Period };

/** Okresy dashboardu w kolejności wyświetlania (pierwszy dzień włącznie, `to` = dzień po dzisiejszym). Rok biznesowy w obu trybach (inna etykieta). */
export function dashboardPeriods(today: string, mode: DashMode): DashPeriod[] {
  const to = addDays(today, 1);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const fiscalYear = m >= FISCAL_START_MONTH ? y : y - 1;
  const fiscalFrom = `${fiscalYear}-${String(FISCAL_START_MONTH).padStart(2, "0")}-01`;
  // "all": od początku danych (from = null), niezależnie od trybu
  const from: [DashWindow, string | null][] =
    mode === "rolling"
      ? [["today", today], ["week", addDays(today, -6)], ["month", addDays(today, -29)], ["year", addDays(today, -364)], ["fiscal", fiscalFrom], ["all", null]]
      : [
          ["today", today], ["week", bucketStart(today, "week")], ["month", `${today.slice(0, 7)}-01`], ["year", `${y}-01-01`],
          ["fiscal", fiscalFrom], ["all", null],
        ];
  return from.map(([key, f]) => ({ key, period: { preset: "custom" as const, from: f, to, label: DASH_LABEL[mode][key]! } }));
}

/** Domyślna rozdzielczość szeregu: dni do ~5 tygodni, tygodnie do ~roku, dalej miesiące. */
export function pickGranularity(p: Period, requested: string | undefined, earliest: string | null): Gran {
  if (requested === "day" || requested === "week" || requested === "month") return requested;
  const from = p.from ?? earliest;
  if (!from) return "week";
  const span = dayNum(p.to) - dayNum(from);
  return span <= 35 ? "day" : span <= 400 ? "week" : "month";
}

const toStr = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** Początek przedziału zawierającego dzień (tydzień od poniedziałku, jak date_trunc w Postgresie). */
export function bucketStart(date: string, gran: Gran): string {
  if (gran === "day") return date;
  if (gran === "month") return `${date.slice(0, 7)}-01`;
  const n = dayNum(date);
  const dow = (new Date(n * 86_400_000).getUTCDay() + 6) % 7; // 0 = poniedziałek
  return toStr(n - dow);
}

/** Wszystkie przedziały od `from` do przed `to` (rosnąco), żeby puste okresy też były w tabeli. */
export function buckets(from: string, to: string, gran: Gran, max = 400): string[] {
  const out: string[] = [];
  let cur = bucketStart(from, gran);
  while (dayNum(cur) < dayNum(to) && out.length < max) {
    out.push(cur);
    if (gran === "day") cur = addDays(cur, 1);
    else if (gran === "week") cur = addDays(cur, 7);
    else { const [y, m] = cur.split("-").map(Number); cur = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; }
  }
  return out;
}

export function bucketLabel(start: string, gran: Gran): string {
  if (gran === "day") return start;
  if (gran === "month") return start.slice(0, 7);
  return `tydz. od ${start}`;
}

/** Procent z dzielnika; null, gdy dzielnik to 0. */
export const pct = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);

export const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(v >= 10 || v === 0 ? 0 : 1).replace(".", ",")}%`);

export const fmtDays = (v: number | null) => (v === null ? "—" : v < 10 ? `${v.toFixed(1).replace(".", ",")} d` : `${Math.round(v)} d`);
