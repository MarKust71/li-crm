/**
 * Wspólne funkcje skryptów pracujących na oficjalnym eksporcie danych LinkedIn (CSV): parser, daty, wczytanie pliku.
 * Używają go `linkedin-compare-export.ts` i `import-linkedin-export.ts` (spec 13.6a).
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Wczytuje CSV z eksportu; nagłówek = pierwszy wiersz o najczęstszej liczbie kolumn (pomija wstępne „Notes:”). */
export function loadCsv(dir: string, name: string): Record<string, string>[] {
  const rows = parseCsv(readFileSync(join(dir, name), "utf8").replace(/^﻿/, ""));
  const freq = new Map<number, number>();
  for (const r of rows.slice(1)) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
  const n = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? rows[0].length;
  const hi = rows.findIndex((r) => r.length === n);
  const head = rows[hi];
  return rows.slice(hi + 1).filter((r) => r.length === n).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** Usuwa identyczne rekordy (kolejność kluczy bez znaczenia), zostawia pierwsze wystąpienie. */
function dedupeRows(rows: Record<string, string>[]): Record<string, string>[] {
  const seen = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const key = JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

/**
 * Wczytuje surowy snapshot z API zapisany przez `linkedin-probe.ts` (`snapshot-<DOMENA>.json`); pola jak w CSV.
 * API zwraca prawie każdy rekord dwa razy, więc usuwa powtórki. Pusta lista to błąd: sonda zapisuje ją też po 404.
 */
export function loadSnapshot(dir: string, domain: string): { rows: Record<string, string>[]; raw: number; savedAt: Date } {
  const file = join(dir, `snapshot-${domain}.json`);
  const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>[];
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`snapshot-${domain}.json jest pusty. Pobierz dane ponownie: npm run linkedin:probe -- snapshot ${domain}`);
  }
  return { rows: dedupeRows(data), raw: data.length, savedAt: statSync(file).mtime };
}

const warsaw = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });
export const dayWarsaw = (d: Date) => warsaw.format(d);
export const dayUtc = (d: Date) => d.toISOString().slice(0, 10);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** „22 Nov 2026” → „2026-11-22” (dzień kalendarzowy, bez godziny). */
export function parseConnectedOn(s: string): string | null {
  const m = /^(\d{1,2}) (\w{3}) (\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2]);
  return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** „11/22/26, 09:15 PM” (czas UTC) → Date. */
export function parseSentAt(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "PM") h += 12;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2]), h, Number(m[5])));
}
