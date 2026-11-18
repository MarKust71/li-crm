/**
 * Jednorazowo: uzupełnia zdarzenie „Wyświetlił(a) mój profil” (VIEWED_MY_PROFILE) dla kontaktów, które arkusze oznaczały jako oglądających:
 *  - 1000-osob: wiersze z TRUE w „Viewed” albo „onViewersList” oraz cała zakładka „Viewers”,
 *  - li-contact-data-store/viewers: cała zakładka (gdy jest „timestamp”: prawdziwa data zebrania, inaczej data nieznana).
 * Data nieznana = znacznik 2000-01-01 z `dateUnknown = true` (jak w arkuszach). Zdarzenie przechodzi przez `addEventTx`
 * (przeliczenie etapu, automatyzacje, ta sama ścieżka co z UI); jedno wspólne podsumowanie w dzienniku (`ingest.backfill_viewed`).
 * Kontakty, które już mają VIEWED_MY_PROFILE, są pomijane (bezpieczne do powtórzenia). Nowych kontaktów nie zakładamy.
 *
 *   npx tsx --env-file=.env scripts/backfill-viewed.ts          # na sucho
 *   npx tsx --env-file=.env scripts/backfill-viewed.ts --apply  # wykonuje
 *
 * Baza docelowa = DATABASE_URL (host wypisywany na początku). Wymaga data/snapshots.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { addEventTx } from "../lib/contact-events";
import { logActivity } from "../lib/activity-log";
import { prisma } from "../lib/prisma";
import { normalizeProfileUrl } from "../lib/profile-url";
import { VIEWED_UNKNOWN_DATE } from "../lib/viewed";

type Snap = { sheet: string; values: unknown[][] };
const SNAP = path.join("data", "snapshots");
const read = (dir: string, file: string): Snap => JSON.parse(readFileSync(path.join(SNAP, dir, file), "utf8"));
const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const truthy = (v: unknown) => v === true || (typeof v === "string" && ["TRUE", "PRAWDA", "TAK", "YES"].includes(v.trim().toUpperCase()));

function records(snap: Snap, headerRow: number) {
  const header = (snap.values[headerRow] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const col = (k: string) => header.indexOf(k);
  return { col, rows: snap.values.slice(headerRow + 1).filter((r) => !r.every(empty)) };
}

/** url → data wyświetlenia (null = nieznana). Prawdziwa data wygrywa z nieznaną. */
const found = new Map<string, Date | null>();
const stats: Record<string, number> = {};
function note(url: string | null, date: Date | null, src: string) {
  if (!url) return;
  stats[src] = (stats[src] ?? 0) + 1;
  const cur = found.get(url);
  if (cur === undefined || (cur === null && date)) found.set(url, date);
  else if (cur && date && date < cur) found.set(url, date);
}

function collect() {
  for (const f of readdirSync(path.join(SNAP, "1000-osob")).filter((x) => x.endsWith(".json"))) {
    const snap = read("1000-osob", f);
    const { col, rows } = records(snap, 3);
    const u = col("profileurl");
    const flags = [col("viewed"), col("onviewerslist")].filter((i) => i >= 0);
    const all = snap.sheet === "Viewers";
    for (const r of rows) if (all || flags.some((i) => truthy(r[i]))) note(normalizeProfileUrl(r[u]), null, `1000-osob/${snap.sheet}`);
  }
  const snap = read("li-contact-data-store", "viewers.json");
  const { col, rows } = records(snap, 0);
  const u = col("profileurl");
  const t = col("timestamp");
  for (const r of rows) {
    const d = t >= 0 && !empty(r[t]) ? new Date(String(r[t])) : null;
    note(normalizeProfileUrl(r[u]), d && !Number.isNaN(d.getTime()) ? d : null, "li-contact-data-store/viewers");
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);
  collect();
  console.log("Z arkuszy (wiersze):", stats, `· unikalnych adresów: ${found.size}`);

  const urls = [...found.keys()];
  const todo: { id: string; name: string; at: Date | null }[] = [];
  let missing = 0;
  let already = 0;
  for (let i = 0; i < urls.length; i += 1000) {
    const rows = await prisma.contact.findMany({
      where: { profileUrl: { in: urls.slice(i, i + 1000) } },
      select: { id: true, name: true, profileUrl: true, _count: { select: { events: { where: { type: "VIEWED_MY_PROFILE" } } } } },
    });
    for (const c of rows) {
      if (c._count.events) already++;
      else todo.push({ id: c.id, name: c.name, at: found.get(c.profileUrl) ?? null });
    }
    missing += urls.slice(i, i + 1000).length - rows.length;
  }
  const withDate = todo.filter((t) => t.at).length;
  console.log(`Do uzupełnienia: ${todo.length} (z prawdziwą datą: ${withDate}, nieznana data: ${todo.length - withDate}); już mają zdarzenie: ${already}; adresy bez kontaktu w bazie: ${missing}`);
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  let done = 0;
  for (const t of todo) {
    await prisma.$transaction(async (tx) => {
      // sprawdzamy jeszcze raz w transakcji: powtórne uruchomienie ani równoległy import nie zdubluje zdarzenia
      if (await tx.contactEvent.count({ where: { contactId: t.id, type: "VIEWED_MY_PROFILE" } })) return;
      await addEventTx(tx, t.id, { type: "VIEWED_MY_PROFILE", occurredAt: t.at ?? VIEWED_UNKNOWN_DATE, dateUnknown: !t.at }, { skipLog: true });
      done++;
    });
  }
  await logActivity({ source: "SYNC", action: "ingest.backfill_viewed", summary: `Uzupełniono „Wyświetlił(a) mój profil” z arkuszy: ${done} kontaktów`, details: { added: done, withDate, unknownDate: todo.length - withDate } });
  console.log(`Dodano zdarzeń: ${done}`);
}
main().finally(() => prisma.$disconnect());
