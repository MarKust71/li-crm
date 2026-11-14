// Import przypomnień z kalendarza Google "dMb" (snapshot: scripts/snapshot-calendar.ts) do tabeli Reminder.
//
//   npx tsx scripts/import-calendar.ts            # DRY RUN: tylko raport, bez zapisu do bazy
//   npx tsx scripts/import-calendar.ts --apply    # zapis (idempotentny: wydarzenie ma unikalny googleEventId)
//
// Raport: data/reports/calendar-import-report.json (zawiera dane osobowe; data/ jest w .gitignore).
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ReminderKind, ReminderStatus } from "@prisma/client";
import { normalizeProfileUrl } from "../lib/profile-url";
import { warsawToUtc } from "../lib/dates";

const APPLY = process.argv.includes("--apply");

type CalEvent = {
  id: string;
  summary: string | null;
  description: string | null;
  start: { date?: string; dateTime?: string };
  updated?: string;
};
const snap = JSON.parse(readFileSync("data/snapshots/calendar/dMb.json", "utf8")) as { calendarId: string; events: CalEvent[] };

// ───────────────────────── parsowanie ─────────────────────────

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Adres profilu z opisu: zwykły tekst, HTML (<a href>) albo przekierowanie google.com/url?q=… */
function extractProfileUrl(description: string): string | null {
  const text = description
    .replace(/&amp;/g, "&")
    .replace(/https?:\/\/www\.google\.com\/url\?q=([^&"'<> ]+)[^"'<> ]*/gi, (_, u: string) => safeDecode(u));
  const m = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^\s"'<>)?&#/]+)/i.exec(text);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

const THREAD_RE = /https?:\/\/(?:www\.)?linkedin\.com\/messaging\/thread\/[^\s"'<>]+/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

function plainLines(description: string): string[] {
  return description
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function extractEmail(description: string): string | null {
  for (const line of plainLines(description)) if (!/https?:/.test(line)) { const m = EMAIL_RE.exec(line); if (m) return m[0].toLowerCase(); }
  return null;
}

/** Telefon: linia złożona z cyfr, spacji, +, - (co najmniej 9 cyfr), bez adresów. */
function extractPhone(description: string): string | null {
  for (const line of plainLines(description)) {
    if (/https?:|@/.test(line)) continue;
    if (/^[+\d][\d\s-]{7,}$/.test(line) && line.replace(/\D/g, "").length >= 9) return line;
  }
  return null;
}

const MARKER_RE = /^\s*([vVxX-])\s+/;

type Parsed = {
  status: ReminderStatus;
  kind: ReminderKind;
  note: string | null;
  name: string | null;
  skipReason?: string;
};

function parseTitle(rawTitle: string): Parsed {
  const marker = MARKER_RE.exec(rawTitle)?.[1];
  const title = rawTitle.replace(MARKER_RE, "").replace(/\s+/g, " ").trim();
  const status: ReminderStatus = marker ? "DONE" : "OPEN";

  // spotkania (BOM) i follow-upy to nie przypomnienia: pomijamy (decyzja użytkownika)
  // także z prefiksem niepewności: "? BP: …", "<> BP: …"
  if (/^(?:Mój\s+|[?<>\s]+)?BP\s*:/i.test(title)) return { status, kind: "REMINDER", note: null, name: null, skipReason: "spotkanie BP" };
  if (/^FU\s*:/i.test(title)) return { status, kind: "REMINDER", note: null, name: null, skipReason: "follow-up FU" };

  let m = /dMb Li (reminder|reconnect):\s*(.+)$/i.exec(title);
  if (m) return { status, kind: m[1].toLowerCase() === "reconnect" ? "RECONNECT" : "REMINDER", note: null, name: m[2].trim() };

  m = /^dMb Li\s*:\s*(.+)$/i.exec(title); // "dMb Li: Imię Nazwisko"
  if (m) return { status, kind: "REMINDER", note: null, name: m[1].trim() };

  m = /^(?:dMb Li|LI)\s+(.+?)\s*(?::|\s-\s)\s*(.+)$/.exec(title); // "dMb Li Imię Nazwisko: umówić BP"
  if (m) return { status, kind: "REMINDER", note: m[2].trim(), name: m[1].trim() };

  m = /^(?:dMb Li|LI)\s+(.+)$/.exec(title); // "dMb Li Imię Nazwisko" (bez czynności)
  if (m) return { status, kind: "REMINDER", note: null, name: m[1].trim() };

  // pozostałe tytuły ("Przypomnienie: …", "BP - decyzja: …", "dMb: ponowić umówienie terminu - Imię"): cały tytuł jako notatka
  const nameAfterDash = / - ([^-:]+)$/.exec(title)?.[1]?.trim() ?? null;
  return { status, kind: "REMINDER", note: title, name: nameAfterDash };
}

function slugToName(url: string): string {
  const slug = url.split("/in/")[1] ?? url;
  return slug.replace(/-[0-9a-f]{6,}$/i, "").replace(/-/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// ───────────────────────── przetwarzanie ─────────────────────────

type Item = {
  eventId: string;
  profileUrl: string;
  kind: ReminderKind;
  status: ReminderStatus;
  note: string | null;
  dueAt: Date;
  allDay: boolean;
  doneAt: Date | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  title: string;
};

const items: Item[] = [];
const skipped: { title: string; reason: string }[] = [];
const unparsableUrl: string[] = [];
let noUrl = 0;

for (const e of snap.events) {
  if (!e.description) { noUrl++; continue; }
  const raw = extractProfileUrl(e.description);
  if (!raw) { noUrl++; continue; }
  const profileUrl = normalizeProfileUrl(raw);
  if (!profileUrl) { unparsableUrl.push(e.summary ?? e.id); continue; }

  const p = parseTitle(e.summary ?? "");
  if (p.skipReason) { skipped.push({ title: e.summary ?? "", reason: p.skipReason }); continue; }

  const allDay = Boolean(e.start.date);
  let dueAt: Date;
  if (e.start.date) {
    const [y, mo, d] = e.start.date.split("-").map(Number);
    dueAt = warsawToUtc(y, mo, d);
  } else {
    dueAt = new Date(e.start.dateTime!);
  }
  const thread = THREAD_RE.exec(e.description.replace(/&amp;/g, "&"))?.[0] ?? null;
  const note = [p.note, thread ? `Wątek: ${thread}` : null].filter(Boolean).join("\n") || null;

  items.push({
    eventId: e.id, profileUrl, kind: p.kind, status: p.status, note, dueAt, allDay,
    doneAt: p.status === "DONE" && e.updated ? new Date(e.updated) : null,
    name: p.name, email: extractEmail(e.description), phone: extractPhone(e.description),
    title: e.summary ?? "",
  });
}

// ───────────────────────── raport / zapis ─────────────────────────

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const contacts = await prisma.contact.findMany({ select: { id: true, profileUrl: true, email: true, phone: true } });
    const byUrl = new Map(contacts.map((c) => [c.profileUrl, c]));
    const existing = new Set(
      (await prisma.reminder.findMany({ where: { googleCalendarId: snap.calendarId }, select: { googleEventId: true } })).map((r) => r.googleEventId),
    );

    const toCreateContacts = new Map<string, Item>();
    const fillExisting: { id: string; email?: string; phone?: string }[] = [];
    for (const it of items) {
      const c = byUrl.get(it.profileUrl);
      if (!c) {
        const prev = toCreateContacts.get(it.profileUrl);
        if (!prev) toCreateContacts.set(it.profileUrl, it);
        else { prev.email ??= it.email; prev.phone ??= it.phone; prev.name ??= it.name; }
      } else if ((!c.email && it.email) || (!c.phone && it.phone)) {
        const prev = fillExisting.find((x) => x.id === c.id) ?? (fillExisting.push({ id: c.id }), fillExisting[fillExisting.length - 1]);
        if (!c.email && it.email) prev.email ??= it.email;
        if (!c.phone && it.phone) prev.phone ??= it.phone;
      }
    }
    const fresh = items.filter((it) => !existing.has(it.eventId));

    const count = <T,>(arr: T[], key: (x: T) => string) => arr.reduce<Record<string, number>>((a, x) => ((a[key(x)] = (a[key(x)] ?? 0) + 1), a), {});
    const summary = {
      mode: APPLY ? "apply" : "dry-run",
      eventsInSnapshot: snap.events.length,
      withoutLinkedInUrl: noUrl,
      skippedMeetingsAndFollowUps: count(skipped, (s) => s.reason),
      unparsableUrl: unparsableUrl.length,
      remindersToImport: items.length,
      alreadyImported: items.length - fresh.length,
      byKind: count(items, (i) => i.kind),
      byStatus: count(items, (i) => i.status),
      allDay: count(items, (i) => (i.allDay ? "całodniowe" : "z godziną")),
      matchedToContact: items.filter((i) => byUrl.has(i.profileUrl)).length,
      contactsToCreate: toCreateContacts.size,
      existingContactsToFillEmailPhone: fillExisting.length,
      overdueOpen: items.filter((i) => i.status === "OPEN" && i.dueAt < new Date()).length,
    };
    console.log(JSON.stringify(summary, null, 2));

    mkdirSync(path.join("data", "reports"), { recursive: true });
    writeFileSync(
      path.join("data", "reports", "calendar-import-report.json"),
      JSON.stringify(
        {
          ...summary,
          contactsToCreate: [...toCreateContacts.values()].map((i) => ({ profileUrl: i.profileUrl, name: i.name ?? slugToName(i.profileUrl), email: i.email, phone: i.phone, fromTitle: i.title })),
          skipped,
          notesWithoutParsedName: items.filter((i) => !i.name).map((i) => i.title),
          sampleNotes: items.filter((i) => i.note).slice(0, 15).map((i) => ({ title: i.title, note: i.note })),
        },
        null,
        2,
      ),
    );
    console.log("Raport: data/reports/calendar-import-report.json");
    if (!APPLY) return;

    // utwórz brakujące kontakty
    const created = new Map<string, string>();
    for (const [url, it] of toCreateContacts) {
      const id = randomUUID();
      created.set(url, id);
      await prisma.contact.create({
        data: {
          id, profileUrl: url, name: it.name ?? slugToName(url), email: it.email, phone: it.phone,
          direction: "OUTBOUND", source: "IMPORT", contactFrom: "Kalendarz dMb",
        },
      });
    }
    for (const f of fillExisting) await prisma.contact.update({ where: { id: f.id }, data: { email: f.email, phone: f.phone } });

    const res = await prisma.reminder.createMany({
      skipDuplicates: true,
      data: fresh.map((it) => ({
        contactId: byUrl.get(it.profileUrl)?.id ?? created.get(it.profileUrl)!,
        kind: it.kind, dueAt: it.dueAt, allDay: it.allDay, note: it.note, status: it.status, doneAt: it.doneAt,
        source: "IMPORT" as const, googleEventId: it.eventId, googleCalendarId: snap.calendarId,
      })),
    });
    console.log(`Zapisano: ${res.count} przypomnień, ${created.size} nowych kontaktów, ${fillExisting.length} uzupełnionych kontaktów.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
