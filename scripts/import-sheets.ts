// Import snapshotu arkuszy (data/snapshots, patrz scripts/snapshot-sheets.ts) do bazy.
//
//   npx tsx scripts/import-sheets.ts            # DRY RUN: tylko raport, bez dostępu do bazy
//   npx tsx scripts/import-sheets.ts --apply    # zapis do bazy (tylko do PUSTEJ bazy)
//
// Raport: data/reports/import-report.json (zawiera dane osobowe, katalog jest w .gitignore).
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ArchiveReason, Direction, EventType, Source, Stage } from "@prisma/client";
import { normalizeProfileUrl } from "../lib/profile-url";
import { computeStage } from "../lib/stage";

const APPLY = process.argv.includes("--apply");
const SNAP = path.join("data", "snapshots");
const TZ = "Europe/Warsaw";
const IMPORT_AT = new Date(); // data dla zdarzeń bez daty (spec 5.1: onViewersList)

// ───────────────────────── daty ─────────────────────────

const tzFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function tzOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(tzFmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}
function warsawToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = wall - tzOffsetMs(wall);
  t = wall - tzOffsetMs(t);
  return new Date(t);
}
/** Numer seryjny arkusza (epoka 1899-12-30) → chwila w strefie Europe/Warsaw. */
function serialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const days = Math.floor(serial);
  const secs = Math.round((serial - days) * 86400);
  const base = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
  return warsawToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, secs);
}
function parseDate(v: unknown): Date | null {
  if (typeof v === "number") return serialToDate(v);
  if (typeof v === "string") {
    const s = v.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return warsawToUtc(+m[1], +m[2], +m[3], 0, 0, 0);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (m) return warsawToUtc(+m[3], +m[2], +m[1], 0, 0, 0);
  }
  return null;
}
const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["TRUE", "PRAWDA", "TAK", "YES"].includes(v.trim().toUpperCase());
  return false;
}
const str = (v: unknown): string | null => (isEmpty(v) ? null : String(v).trim());

// ───────────────────────── raport ─────────────────────────

const report = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "dry-run",
  tabs: {} as Record<string, Record<string, number>>,
  unmappedColumns: {} as Record<string, Record<string, number>>,
  imputedDates: {} as Record<string, number>,
  skippedEvents: {} as Record<string, number>,
  unparsedDates: [] as { tab: string; row: number; column: string; value: unknown }[],
  invalidRows: [] as { tab: string; row: number; reason: string; url?: unknown }[],
  duplicatesMerged: [] as { url: string; tabs: string[] }[],
  conflicts: [] as { url: string; field: string; kept: unknown; other: unknown; tab: string }[],
  assumptions: [
    "Zaprosili mnie: Invite→INVITE_RECEIVED, Appreciation→REACTION_RECEIVED (+Appr.-text jako message), Appr.-response→THANKS_SENT",
    "Viewed/onViewersList bez daty: zdarzenie VIEWED_MY_PROFILE NIE jest tworzone (decyzja użytkownika, odstępstwo od spec 5.1)",
    "Open-To-Talk/NO/Decision-* = TRUE bez daty: najpóźniejsza znana data z wiersza (spec 5.1); gdy brak: data importu",
    "Ignored=TRUE → archived, archiveReason=OTHER (powód nie jest zapisany w arkuszu)",
    "Zakładka Viewers (1000 osób): tylko osoba + tag; kolumny przynależności do zakładek (formuły) pominięte",
    "li-contact-data-store: każda zakładka = tag; contactFrom = nazwa zakładki, gdy puste; zakładka 'viewers' → Source.VIEWERS, reszta → Source.SEARCH",
  ],
  totals: {} as Record<string, unknown>,
};
const bump = (o: Record<string, number>, k: string, n = 1) => (o[k] = (o[k] ?? 0) + n);
const tabStat = (tab: string) => (report.tabs[tab] ??= {});

// ───────────────────────── model w pamięci ─────────────────────────

type Ev = { type: EventType; occurredAt: Date; message?: string | null; scheduledAt?: Date | null };
type C = {
  id: string; profileUrl: string; name: string; salutation: string | null;
  location: string | null; occupation: string | null; email: string | null; phone: string | null;
  openToWork: boolean; direction: Direction; source: Source; contactFrom: string | null;
  archived: boolean; archiveReason: ArchiveReason | null; info: string | null;
  tabs: Set<string>; events: Ev[]; tags: Set<string>;
};
type Capture = { contactId: string; source: Source; payload: unknown; receivedAt: Date };
type TimeRow = { startedAt: Date; endedAt: Date | null; activity: string | null; count: number | null; note: string | null };

const contacts = new Map<string, C>();
const captures: Capture[] = [];
const timeRows: TimeRow[] = [];

function mergeField<K extends "name" | "location" | "occupation" | "email" | "phone" | "info" | "contactFrom">(
  c: C, key: K, value: string | null, tab: string,
) {
  if (!value) return;
  const cur = c[key] as string | null;
  if (!cur) (c[key] as string | null) = value;
  else if (cur !== value && key !== "info" && key !== "contactFrom") {
    report.conflicts.push({ url: c.profileUrl, field: key, kept: cur, other: value, tab });
  }
}

function getContact(url: string, init: () => Partial<C>, tab: string): { c: C; created: boolean } {
  let c = contacts.get(url);
  if (c) return { c, created: false };
  c = {
    id: randomUUID(), profileUrl: url, name: "", salutation: null, location: null, occupation: null,
    email: null, phone: null, openToWork: false, direction: "OUTBOUND", source: "IMPORT", contactFrom: null,
    archived: false, archiveReason: null, info: null, tabs: new Set(), events: [], tags: new Set(),
    ...init(),
  };
  contacts.set(url, c);
  return { c, created: true };
}
function addEvent(c: C, e: Ev) {
  const key = (x: Ev) => `${x.type}|${x.occurredAt.getTime()}|${x.message ?? ""}`;
  if (!c.events.some((x) => key(x) === key(e))) c.events.push(e);
}

// ───────────────────────── wczytywanie ─────────────────────────

type Snap = { sheet: string; values: unknown[][] };
const readSnap = (dir: string, file: string): Snap => JSON.parse(readFileSync(path.join(SNAP, dir, file), "utf8"));
const listSnaps = (dir: string) => readdirSync(path.join(SNAP, dir)).filter((f) => f.endsWith(".json"));

// Aliasy nagłówków (porównanie bez rozróżniania wielkości liter, mapowanie po nazwie, nigdy po pozycji).
const ALIAS: Record<string, string> = {
  "are-you-open-text": "a-y-o-text",
  "a-y-o-resp.": "a-y-o-response",
  "connect-msg.": "connect-msg",
  osoba: "name",
  viewer: "name", "loc.": "location", "ocu.": "occupation", isopentowork: "otw",
  "appr.-response": "appr.-resp.",
};

function toRecords(snap: Snap, headerRow: number, tab: string) {
  const header = (snap.values[headerRow] ?? []).map((h) => String(h ?? "").trim());
  const known = new Set<number>();
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    if (!h) return;
    const k = ALIAS[h.toLowerCase()] ?? h.toLowerCase();
    if (!idx.has(k)) idx.set(k, i);
  });
  const rows = snap.values.slice(headerRow + 1).map((r, i) => ({ rowNo: headerRow + 2 + i, r }));
  return { header, idx, rows, known };
}

// ───────────────────────── 1000 osób ─────────────────────────

const STAGE_COLS = [
  "connect", "accept", "appreciation", "appr.-resp.", "are-you-open", "a-y-o-reminder", "a-y-o-response",
  "a-y-o-decision", "meet-proposal", "meet-proposal-reminder", "bp-date", "confirmed", "bp-canceled",
  "bp-noshow", "bp-completed", "invite",
];
const USED = new Set([
  "name", "location", "occupation", "contact-from", "otw", "connect-msg", "viewed", "ignored", "delay",
  "appr.-resp.-msg", "a-y-o-text", "a-y-o-reminder-text", "open-to-talk", "no", "no-response-text",
  "meet-proposal-text", "meet-proposal-reminder-text", "decision-yes", "decision-no", "info", "email",
  "phone", "profileurl", "onviewerslist", "l.p.", "appr.-text", ...STAGE_COLS,
]);
// kolumny pomocnicze/formuły - świadomie pomijane, nie raportujemy ich jako "niezmapowane"
const DERIVED = new Set(["found", "hide", "profileuri", "contactfrom", "viewer", "loc.", "ocu."]);

const TAB_ORDER = [
  "Ja zapraszam", "Zaprosili mnie", "Częstochowa", "Wrocław", "Kraków", "Szczecin", "Warszawa", "Katowice",
  "Katowice - reconnect", "Wrocław (nauczycielki)", "OpenToWork", "Oglądali mnie", "Kontakty", "Viewers",
];
const SALUTATION = /^(?:Dzień dobry|Dobry wieczór|Dobry dzień|Cześć|Witam)[,!]?\s+((?:Pani|Panie|Pan)\s+\p{L}+)/u;

function importMainTab(tab: string) {
  const snap = readSnap("1000-osob", `${tab.replace(/[\\/]/g, "_")}.json`);
  const { header, idx, rows } = toRecords(snap, 3, tab);
  const st = tabStat(tab);
  const inbound = tab === "Zaprosili mnie";
  const isViewers = tab === "Viewers";
  // kolumny niezmapowane: policz niepuste wartości
  const unmapped: Record<string, number> = {};
  header.forEach((h, i) => {
    const k = ALIAS[h.toLowerCase()] ?? h.toLowerCase();
    if (!h || USED.has(k) || DERIVED.has(k) || idx.get(k) !== i) return;
    if (isViewers && /^(czestochowa|wroclaw|krakow|szczecin|warszawa|katowice|jazapraszam|zaprosilimnie|wroclawnauczycielki|opentowork|ogladalimnie)$/.test(k)) return;
    unmapped[h] = 0;
  });

  const get = (r: unknown[], k: string) => {
    const i = idx.get(k);
    return i === undefined ? undefined : r[i];
  };
  const dateOf = (r: unknown[], k: string, rowNo: number): Date | null => {
    const v = get(r, k);
    if (isEmpty(v) || typeof v === "boolean") return null;
    const d = parseDate(v);
    if (!d) report.unparsedDates.push({ tab, row: rowNo, column: k, value: v });
    return d;
  };

  for (const { rowNo, r } of rows) {
    if (r.every(isEmpty)) continue;
    st.rows = (st.rows ?? 0) + 1;
    const rawUrl = get(r, "profileurl");
    const url = normalizeProfileUrl(rawUrl);
    if (!url) {
      report.invalidRows.push({ tab, row: rowNo, reason: isEmpty(rawUrl) ? "brak profileUrl" : "nie jest profilem /in/", url: rawUrl });
      bump(st, "invalid");
      continue;
    }
    for (const col of Object.keys(unmapped)) {
      const i = idx.get(ALIAS[col.toLowerCase()] ?? col.toLowerCase());
      if (i !== undefined && !isEmpty(r[i])) unmapped[col]++;
    }

    const name = str(get(r, "name"));
    const { c, created } = getContact(
      url,
      () => ({ direction: inbound ? "INBOUND" : "OUTBOUND", source: "IMPORT" }),
      tab,
    );
    if (created) bump(st, "newContacts");
    else {
      bump(st, "mergedIntoExisting");
      report.duplicatesMerged.push({ url, tabs: [...c.tabs, tab] });
      if (!isViewers && c.direction !== (inbound ? "INBOUND" : "OUTBOUND")) {
        report.conflicts.push({ url, field: "direction", kept: c.direction, other: inbound ? "INBOUND" : "OUTBOUND", tab });
      }
    }
    c.tabs.add(tab);
    c.tags.add(tab);
    mergeField(c, "name", name, tab);
    mergeField(c, "location", str(get(r, "location")), tab);
    mergeField(c, "occupation", str(get(r, "occupation")), tab);
    mergeField(c, "contactFrom", str(get(r, "contact-from")), tab);
    mergeField(c, "info", str(get(r, "info")), tab);
    mergeField(c, "email", str(get(r, "email")), tab);
    mergeField(c, "phone", str(get(r, "phone")), tab);
    if (truthy(get(r, "otw"))) c.openToWork = true;
    if (truthy(get(r, "ignored"))) {
      c.archived = true;
      c.archiveReason ??= "OTHER";
    }

    // zakładka Viewers: sama osoba + tag; arkusz nie podaje daty wyświetlenia, więc bez zdarzenia
    if (isViewers) {
      bump(report.skippedEvents, "VIEWED_MY_PROFILE bez daty (Viewers)");
      continue;
    }

    const d = (k: string) => dateOf(r, k, rowNo);
    const known: Date[] = [];
    const push = (e: Ev) => {
      addEvent(c, e);
      known.push(e.occurredAt);
    };
    const inviteDate = d(inbound ? "invite" : "connect");
    const inviteMsg = str(get(r, "connect-msg"));
    if (inviteDate) push({ type: inbound ? "INVITE_RECEIVED" : "INVITE_SENT", occurredAt: inviteDate, message: inviteMsg });
    if (!c.salutation && inviteMsg) c.salutation = SALUTATION.exec(inviteMsg)?.[1] ?? null;
    const accept = d("accept");
    if (accept) push({ type: "ACCEPTED", occurredAt: accept });
    const appr = d("appreciation");
    if (appr) push({ type: "REACTION_RECEIVED", occurredAt: appr, message: str(get(r, "appr.-text")) });
    const thanks = d("appr.-resp.");
    if (thanks) push({ type: "THANKS_SENT", occurredAt: thanks, message: str(get(r, "appr.-resp.-msg")) });
    const ayo = d("are-you-open");
    if (ayo) push({ type: "ASKED_OPEN", occurredAt: ayo, message: str(get(r, "a-y-o-text")) });
    const rem = d("a-y-o-reminder");
    if (rem) push({ type: "ASKED_OPEN_REMINDER", occurredAt: rem, message: str(get(r, "a-y-o-reminder-text")) });
    const resp = d("a-y-o-response");
    if (resp) push({ type: "ASKED_OPEN_RESPONSE", occurredAt: resp });
    const decisionDate = d("a-y-o-decision");
    const latestKnown = () => (known.length ? new Date(Math.max(...known.map((x) => x.getTime()))) : null);
    const impute = (label: string) => {
      bump(report.imputedDates, label);
      return latestKnown() ?? IMPORT_AT;
    };

    const yes = truthy(get(r, "open-to-talk"));
    const no = truthy(get(r, "no"));
    if (yes) push({ type: "OPEN_TO_TALK", occurredAt: decisionDate ?? impute("OPEN_TO_TALK") });
    if (no) push({ type: "NOT_INTERESTED", occurredAt: decisionDate ?? impute("NOT_INTERESTED"), message: str(get(r, "no-response-text")) });
    if (decisionDate && !yes && !no) bump(st, "decisionDateWithoutType");

    const prop = d("meet-proposal");
    if (prop) push({ type: "MEETING_PROPOSED", occurredAt: prop, message: str(get(r, "meet-proposal-text")) });
    const propRem = d("meet-proposal-reminder");
    if (propRem) push({ type: "MEETING_PROPOSAL_REMINDER", occurredAt: propRem, message: str(get(r, "meet-proposal-reminder-text")) });
    const bp = d("bp-date");
    if (bp) push({ type: "BP_SCHEDULED", occurredAt: bp, scheduledAt: bp });
    for (const [col, type] of [["confirmed", "BP_CONFIRMED"], ["bp-canceled", "BP_CANCELED"], ["bp-noshow", "BP_NO_SHOW"], ["bp-completed", "BP_COMPLETED"]] as const) {
      const x = d(col);
      if (x) push({ type, occurredAt: x });
    }
    if (truthy(get(r, "decision-yes"))) push({ type: "DECISION_YES", occurredAt: impute("DECISION_YES") });
    if (truthy(get(r, "decision-no"))) push({ type: "DECISION_NO", occurredAt: impute("DECISION_NO") });

    if (truthy(get(r, "viewed")) || truthy(get(r, "onviewerslist"))) {
      // Viewed/onViewersList to flagi bez daty: nie tworzymy zdarzenia z zadaną datą
      bump(report.skippedEvents, "VIEWED_MY_PROFILE bez daty");
    }
  }
  report.unmappedColumns[tab] = Object.fromEntries(Object.entries(unmapped).filter(([, n]) => n > 0));
}

// ───────────────────────── li-contact-data-store ─────────────────────────

function importStoreTab(file: string) {
  const snap = readSnap("li-contact-data-store", file);
  const tab = `store/${snap.sheet}`;
  const { idx, rows } = toRecords(snap, 0, tab);
  const st = tabStat(tab);
  const source: Source = snap.sheet.toLowerCase() === "viewers" ? "VIEWERS" : "SEARCH";
  const get = (r: unknown[], k: string) => {
    const i = idx.get(k);
    return i === undefined ? undefined : r[i];
  };
  for (const { rowNo, r } of rows) {
    if (r.every(isEmpty)) continue;
    st.rows = (st.rows ?? 0) + 1;
    const url = normalizeProfileUrl(get(r, "profileurl"));
    if (!url) {
      report.invalidRows.push({ tab, row: rowNo, reason: "brak/niepoprawny profileUrl", url: get(r, "profileurl") });
      bump(st, "invalid");
      continue;
    }
    const { c, created } = getContact(url, () => ({ source, stage: "CAPTURED" } as Partial<C>), tab);
    if (created) bump(st, "newContacts");
    else bump(st, "mergedIntoExisting");
    c.tabs.add(tab);
    c.tags.add(snap.sheet);
    mergeField(c, "name", str(get(r, "name")), tab);
    mergeField(c, "location", str(get(r, "location")), tab);
    mergeField(c, "occupation", str(get(r, "occupation")), tab);
    mergeField(c, "contactFrom", str(get(r, "contact-from")) ?? snap.sheet, tab);
    if (truthy(get(r, "open-to-work"))) c.openToWork = true;
    const ts = parseDate(get(r, "timestamp"));
    if (!ts) report.unparsedDates.push({ tab, row: rowNo, column: "timestamp", value: get(r, "timestamp") });
    captures.push({
      contactId: c.id,
      source,
      receivedAt: ts ?? IMPORT_AT,
      payload: {
        name: str(get(r, "name")), location: str(get(r, "location")), occupation: str(get(r, "occupation")),
        contactFrom: str(get(r, "contact-from")), openToWork: truthy(get(r, "open-to-work")),
        profileUrl: str(get(r, "profileurl")), timestamp: str(get(r, "timestamp")), importedFromTab: snap.sheet,
      },
    });
  }
}

// ───────────────────────── li-time ─────────────────────────

function importTime(file: string) {
  const snap = readSnap("li-time", file);
  const tab = `time/${snap.sheet}`;
  const st = tabStat(tab);
  for (let i = 1; i < snap.values.length; i++) {
    const r = snap.values[i];
    const start = parseDate(r[0]);
    if (isEmpty(r[0]) && isEmpty(r[1]) && isEmpty(r[3])) continue;
    st.rows = (st.rows ?? 0) + 1;
    if (!start) {
      report.invalidRows.push({ tab, row: i + 1, reason: "brak/niepoprawny start", url: r[0] });
      bump(st, "invalid");
      continue;
    }
    const end = isEmpty(r[1]) ? null : parseDate(r[1]);
    if (!isEmpty(r[1]) && !end) report.unparsedDates.push({ tab, row: i + 1, column: "end", value: r[1] });
    if (end && end < start) bump(st, "endBeforeStart");
    const comment = str(r[3]);
    let activity: string | null = null;
    let count: number | null = null;
    let note: string | null = null;
    if (comment) {
      const parts = comment.split(/\s*,\s*/);
      // "akceptacja (3)" → czynność + liczba; ogon po liczbie, np. "(1 otwarta)", trafia do note
      const m = /^(.*?)\s*\((\d+)\)\s*(.*)$/.exec(parts[0]) ?? /^(.*)$/.exec(parts[0])!;
      activity = m[1].trim() || null;
      count = m[2] ? Number(m[2]) : null;
      if (m[3]) note = m[3].trim();
      if (parts.length > 1) {
        note = comment; // kilka czynności w jednym wpisie: zachowaj pełny opis
        bump(st, "multiActivity");
      }
    }
    timeRows.push({ startedAt: start, endedAt: end, activity, count, note });
  }
}

// ───────────────────────── uruchomienie ─────────────────────────

for (const tab of TAB_ORDER) importMainTab(tab);
for (const f of listSnaps("li-contact-data-store")) importStoreTab(f);
for (const f of listSnaps("li-time")) importTime(f);

const stages: Record<string, number> = {};
for (const c of contacts.values()) {
  c.events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  (c as C & { stage?: Stage }).stage = computeStage(c.events);
  bump(stages, (c as C & { stage?: Stage }).stage!);
}
const activityNames = new Set(timeRows.map((t) => t.activity).filter(Boolean));
report.totals = {
  contacts: contacts.size,
  events: [...contacts.values()].reduce((n, c) => n + c.events.length, 0),
  tags: new Set([...contacts.values()].flatMap((c) => [...c.tags])).size,
  captures: captures.length,
  activityTypes: activityNames.size,
  timeEntries: timeRows.length,
  conflicts: report.conflicts.length,
  duplicatesMerged: report.duplicatesMerged.length,
  invalidRows: report.invalidRows.length,
  unparsedDates: report.unparsedDates.length,
  imputedDates: report.imputedDates,
  skippedEvents: report.skippedEvents,
  stageDistribution: stages,
  archived: [...contacts.values()].filter((c) => c.archived).length,
  withSalutation: [...contacts.values()].filter((c) => c.salutation).length,
};

mkdirSync(path.join("data", "reports"), { recursive: true });
const reportPath = path.join("data", "reports", "import-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`Tryb: ${report.mode}`);
console.log("Podsumowanie:", JSON.stringify(report.totals, null, 2));
console.log("Zakładki:");
for (const [t, s] of Object.entries(report.tabs)) console.log(`  ${t}: ${JSON.stringify(s)}`);
console.log("Niezmapowane kolumny (z danymi):", JSON.stringify(report.unmappedColumns));
console.log(`Pełny raport: ${reportPath}`);

// ───────────────────────── zapis (--apply) ─────────────────────────

async function apply() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const [nc, nt] = await Promise.all([prisma.contact.count(), prisma.timeEntry.count()]);
    if (nc > 0 || nt > 0) throw new Error(`Baza nie jest pusta (Contact=${nc}, TimeEntry=${nt}). Import działa tylko na pustej bazie.`);

    const chunk = <T,>(a: T[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
    const list = [...contacts.values()] as (C & { stage: Stage })[];

    for (const part of chunk(list)) {
      await prisma.contact.createMany({
        data: part.map((c) => ({
          id: c.id, profileUrl: c.profileUrl, name: c.name || c.profileUrl, salutation: c.salutation,
          location: c.location, occupation: c.occupation, email: c.email, phone: c.phone,
          openToWork: c.openToWork, direction: c.direction, source: c.source, contactFrom: c.contactFrom,
          stage: c.stage, archived: c.archived, archiveReason: c.archiveReason, info: c.info,
        })),
      });
    }
    const events = list.flatMap((c) => c.events.map((e) => ({ contactId: c.id, ...e })));
    for (const part of chunk(events, 1000)) await prisma.contactEvent.createMany({ data: part });

    const tagNames = [...new Set(list.flatMap((c) => [...c.tags]))];
    const tagIds = new Map(tagNames.map((n) => [n, randomUUID()]));
    await prisma.tag.createMany({ data: tagNames.map((name) => ({ id: tagIds.get(name)!, name })) });
    const links = list.flatMap((c) => [...c.tags].map((t) => ({ contactId: c.id, tagId: tagIds.get(t)! })));
    for (const part of chunk(links, 2000)) await prisma.contactTag.createMany({ data: part });

    for (const part of chunk(captures, 500)) {
      await prisma.capture.createMany({ data: part.map((x) => ({ ...x, payload: x.payload as object })) });
    }

    const actIds = new Map([...activityNames].map((n) => [n as string, randomUUID()]));
    await prisma.activityType.createMany({ data: [...actIds].map(([name, id]) => ({ id, name })) });
    for (const part of chunk(timeRows)) {
      await prisma.timeEntry.createMany({
        data: part.map((t) => ({
          startedAt: t.startedAt, endedAt: t.endedAt, count: t.count, note: t.note,
          activityTypeId: t.activity ? actIds.get(t.activity)! : null,
        })),
      });
    }
    console.log("Zapisano do bazy.");
  } finally {
    await prisma.$disconnect();
  }
}

if (APPLY) apply().catch((e) => { console.error(e); process.exit(1); });
