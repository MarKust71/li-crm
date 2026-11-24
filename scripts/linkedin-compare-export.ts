/**
 * Porównuje oficjalny eksport danych LinkedIn (CSV) z lokalną bazą li-crm. Tylko odczyt, wypisuje WYŁĄCZNIE liczby.
 *
 *   npm run linkedin:compare -- [folder z CSV]     # domyślnie _linkedin-probe/export/unpacked
 *
 * Zakres: Connections.csv, Invitations.csv, messages.csv vs Contact / ContactEvent (INVITE_SENT, INVITE_RECEIVED, ACCEPTED).
 * Adresy profili normalizowane jak w aplikacji (`normalizeProfileUrl`, spec 6.1). Odmawia, gdy DATABASE_URL nie jest localhost.
 * Dane osobowe nie trafiają na terminal ani do plików. Spec 13.6.
 */
import { PrismaClient } from "@prisma/client";
import { join } from "node:path";
import { normalizeProfileUrl } from "../lib/profile-url";
import { dayUtc, dayWarsaw, loadCsv, parseConnectedOn, parseSentAt } from "./linkedin-export-core";

const dir = process.argv[2] ?? join(process.cwd(), "_linkedin-probe/export/unpacked");
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error("DATABASE_URL nie wskazuje na localhost, przerywam.");
  process.exit(1);
}

const load = (name: string) => loadCsv(dir, name);

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
function bucket(diffs: number[]) {
  const c = { zero: 0, one: 0, other: 0 };
  for (const d of diffs) (Math.abs(d) === 0 ? c.zero++ : Math.abs(d) === 1 ? c.one++ : c.other++);
  return `zgodne ${c.zero}, ±1 dzień ${c.one}, inne ${c.other}`;
}
const norm = (u: string | undefined) => (u ? normalizeProfileUrl(u) : null);

async function main() {
  const prisma = new PrismaClient();
  const contacts = await prisma.contact.findMany({ select: { id: true, profileUrl: true, archived: true, stage: true, source: true } });
  const byUrl = new Map(contacts.map((c) => [c.profileUrl, c]));
  const events = await prisma.contactEvent.findMany({
    where: { type: { in: ["INVITE_SENT", "INVITE_RECEIVED", "ACCEPTED"] } },
    select: { contactId: true, type: true, occurredAt: true, dateUnknown: true, message: true },
  });
  const ev = new Map<string, typeof events>();
  for (const e of events) ev.set(e.contactId, [...(ev.get(e.contactId) ?? []), e]);
  const first = (cid: string, t: string) =>
    (ev.get(cid) ?? []).filter((e) => e.type === t && !e.dateUnknown).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];
  console.log(`Baza: kontaktów ${contacts.length} (zarchiwizowanych ${contacts.filter((c) => c.archived).length}), zdarzeń INVITE_SENT/RECEIVED/ACCEPTED ${events.length}`);

  // ----- Connections -----
  const conns = load("Connections.csv");
  const connUrls = new Map<string, string | null>();
  let badUrl = 0;
  for (const r of conns) {
    const u = norm(r["URL"]);
    if (!u) badUrl++;
    else connUrls.set(u, parseConnectedOn(r["Connected On"]));
  }
  const inDb = [...connUrls.keys()].filter((u) => byUrl.has(u));
  const notInDb = connUrls.size - inDb.length;
  console.log(`\nCONNECTIONS: ${conns.length} wierszy, ${connUrls.size} unikalnych adresów (bez/zły adres: ${badUrl})`);
  console.log(`  w bazie jako kontakt: ${inDb.length}, NIE ma w bazie: ${notInDb}`);
  const withAccepted = inDb.filter((u) => first(byUrl.get(u)!.id, "ACCEPTED"));
  console.log(`  z kontaktów w bazie: ze zdarzeniem ACCEPTED ${withAccepted.length}, bez ACCEPTED ${inDb.length - withAccepted.length}`);
  const stageNoAccept = new Map<string, number>();
  for (const u of inDb.filter((u) => !first(byUrl.get(u)!.id, "ACCEPTED"))) {
    const s = byUrl.get(u)!.stage;
    stageNoAccept.set(s, (stageNoAccept.get(s) ?? 0) + 1);
  }
  console.log(`  bez ACCEPTED wg etapu: ${JSON.stringify(Object.fromEntries(stageNoAccept))}`);
  const diffs: number[] = [];
  for (const u of withAccepted) {
    const co = connUrls.get(u);
    if (co) diffs.push(dayDiff(co, dayWarsaw(first(byUrl.get(u)!.id, "ACCEPTED")!.occurredAt)));
  }
  console.log(`  „Connected On” vs data ACCEPTED (czas warszawski): ${bucket(diffs)}`);
  const acceptedNotConn = contacts.filter((c) => !connUrls.has(c.profileUrl) && first(c.id, "ACCEPTED"));
  console.log(`  kontakty z ACCEPTED, których NIE ma w Connections: ${acceptedNotConn.length} (zarchiwizowanych ${acceptedNotConn.filter((c) => c.archived).length})`);
  const srcNew = new Map<string, number>();
  for (const u of connUrls.keys()) if (!byUrl.has(u)) srcNew.set("brak", (srcNew.get("brak") ?? 0) + 1);

  // ----- Invitations -----
  const inv = load("Invitations.csv");
  const own = (() => {
    const f = new Map<string, number>();
    for (const r of inv) {
      const u = norm(r["Direction"] === "OUTGOING" ? r["inviterProfileUrl"] : r["inviteeProfileUrl"]);
      if (u) f.set(u, (f.get(u) ?? 0) + 1);
    }
    return [...f].sort((a, b) => b[1] - a[1])[0]?.[0];
  })();
  let outInDb = 0, outNotInDb = 0, outWithSent = 0, outNoSent = 0, outMsgEq = 0, outMsgBoth = 0, inIn = 0, inInDb = 0, selfRows = 0;
  const dUtc: number[] = [], dWar: number[] = [];
  const invCounterparts = new Set<string>();
  let earliest = "9999";
  for (const r of inv) {
    const out = r["Direction"] === "OUTGOING";
    const u = norm(out ? r["inviteeProfileUrl"] : r["inviterProfileUrl"]);
    const at = parseSentAt(r["Sent At"]);
    if (at && dayUtc(at) < earliest) earliest = dayUtc(at);
    if (!u || u === own) {
      selfRows++;
      continue;
    }
    invCounterparts.add(u);
    const c = byUrl.get(u);
    if (!out) {
      inIn++;
      if (c) inInDb++;
      continue;
    }
    if (!c) {
      outNotInDb++;
      continue;
    }
    outInDb++;
    const e = first(c.id, "INVITE_SENT");
    if (!e) {
      outNoSent++;
      continue;
    }
    outWithSent++;
    if (at) {
      dUtc.push(dayDiff(dayUtc(at), dayUtc(e.occurredAt)));
      dWar.push(dayDiff(dayWarsaw(at), dayWarsaw(e.occurredAt)));
    }
    if (r["Message"] && e.message) {
      outMsgBoth++;
      if (r["Message"].trim() === e.message.trim()) outMsgEq++;
    }
  }
  console.log(`\nINVITATIONS: ${inv.length} wierszy (od ${earliest}), unikalnych osób ${invCounterparts.size}, wierszy bez adresu/własnych: ${selfRows}`);
  console.log(`  OUTGOING: w bazie ${outInDb}, NIE ma w bazie ${outNotInDb}; z kontaktów w bazie: ze zdarzeniem INVITE_SENT ${outWithSent}, bez ${outNoSent}`);
  console.log(`  data zaproszenia vs INVITE_SENT, czas wg UTC: ${bucket(dUtc)}`);
  console.log(`  data zaproszenia vs INVITE_SENT, czas jako warszawski (Sent At traktowany jako UTC): ${bucket(dWar)}`);
  console.log(`  treść zaproszenia: obie strony mają treść w ${outMsgBoth}, identyczna w ${outMsgEq}`);
  console.log(`  INCOMING: ${inIn}, w bazie ${inInDb}`);
  const since = new Date(`${earliest}T00:00:00Z`);
  const dbSentSince = new Set(events.filter((e) => e.type === "INVITE_SENT" && !e.dateUnknown && e.occurredAt >= since).map((e) => e.contactId));
  const outUrls = new Set(inv.filter((r) => r["Direction"] === "OUTGOING").map((r) => norm(r["inviteeProfileUrl"])));
  const dbSentNotInExport = [...dbSentSince].filter((id) => {
    const c = contacts.find((x) => x.id === id);
    return c && !outUrls.has(c.profileUrl);
  }).length;
  console.log(`  w bazie INVITE_SENT od ${earliest}: ${dbSentSince.size} osób, z nich NIE ma w Invitations.csv: ${dbSentNotInExport}`);
  // Hipoteza: Invitations.csv to tylko zaproszenia oczekujące (przyjęte znikają z listy). Sprawdzenie po etapie w bazie.
  const stageOf = (ids: Iterable<string>) => {
    const m: Record<string, number> = {};
    for (const id of ids) {
      const c = contacts.find((x) => x.id === id);
      if (c) m[c.stage] = (m[c.stage] ?? 0) + 1;
    }
    return JSON.stringify(m);
  };
  const inExportIds = [...dbSentSince].filter((id) => outUrls.has(contacts.find((x) => x.id === id)!.profileUrl));
  const notInExportIds = [...dbSentSince].filter((id) => !outUrls.has(contacts.find((x) => x.id === id)!.profileUrl));
  console.log(`  etap w bazie, są w Invitations.csv: ${stageOf(inExportIds)}`);
  console.log(`  etap w bazie, NIE ma w Invitations.csv: ${stageOf(notInExportIds)}`);

  // ----- Messages -----
  const msgs = load("messages.csv");
  const people = new Set<string>();
  const fromFreq = new Map<string, number>();
  for (const r of msgs) {
    const s = norm(r["SENDER PROFILE URL"]);
    if (s) fromFreq.set(s, (fromFreq.get(s) ?? 0) + 1);
  }
  const me = [...fromFreq].sort((a, b) => b[1] - a[1])[0]?.[0];
  let groupRows = 0;
  const convs = new Map<string, Set<string>>();
  for (const r of msgs) {
    const set = convs.get(r["CONVERSATION ID"]) ?? new Set<string>();
    const s = norm(r["SENDER PROFILE URL"]);
    if (s) set.add(s);
    for (const t of (r["RECIPIENT PROFILE URLS"] ?? "").split(/[,\s]+/).filter(Boolean)) {
      const n = norm(t);
      if (n) set.add(n);
    }
    convs.set(r["CONVERSATION ID"], set);
  }
  let oneToOne = 0;
  for (const set of convs.values()) {
    const others = [...set].filter((u) => u !== me);
    if (others.length === 1) {
      oneToOne++;
      people.add(others[0]);
    } else if (others.length > 1) groupRows++;
  }
  const peopleInDb = [...people].filter((u) => byUrl.has(u)).length;
  const peopleInConn = [...people].filter((u) => connUrls.has(u)).length;
  console.log(`\nMESSAGES: ${msgs.length} wiadomości, ${convs.size} konwersacji (1:1 ${oneToOne}, grupowych ${groupRows})`);
  console.log(`  rozmówców 1:1: ${people.size}, w bazie jako kontakt ${peopleInDb}, w Connections ${peopleInConn}, w Connections ale NIE w bazie ${[...people].filter((u) => connUrls.has(u) && !byUrl.has(u)).length}`);
  const noThread = await prisma.contact.count({ where: { threadUrl: null, profileUrl: { in: [...people].filter((u) => byUrl.has(u)) } } });
  console.log(`  z rozmówców w bazie bez zapisanego wątku (threadUrl): ${noThread}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
