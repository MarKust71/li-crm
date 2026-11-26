/**
 * Uzupełnia bazę danymi z LinkedIn: z oficjalnego eksportu (CSV: Connections.csv, Invitations.csv) albo z API (`--api`). Spec 13.6, 13.6a.
 *
 *   npx tsx --env-file=.env scripts/import-linkedin-export.ts [folder z CSV]          # na sucho
 *   npx tsx --env-file=.env scripts/import-linkedin-export.ts [folder z CSV] --apply  # wykonuje
 *   npx tsx --env-file=.env scripts/import-linkedin-export.ts --api [folder] [--apply]       # dane z API
 *
 * `--api`: czyta snapshot-CONNECTIONS.json i snapshot-INVITATIONS.json z `npm run linkedin:probe -- snapshot CONNECTIONS INVITATIONS`
 * (domyślnie _linkedin-probe/), usuwa powtórzone rekordy i wypisuje datę pobrania. Dalszy przebieg jest taki sam.
 *
 * Domyślny folder CSV: _linkedin-probe/export/unpacked. Baza docelowa = DATABASE_URL (host wypisywany na początku).
 * Na terminal trafiają wyłącznie liczby. Skrypt jest powtarzalny: pomija to, co już jest w bazie.
 *
 * Co robi (osoba = znormalizowany adres profilu, spec 6.1):
 *  1. Kontakt istnieje, jest w Connections, a nie ma `ACCEPTED` → dodaje `ACCEPTED` z „Connected On” (północ czasu warszawskiego).
 *  2. Kontakt istnieje, w Invitations.csv jest jako OUTGOING/INCOMING, a nie ma `INVITE_SENT`/`INVITE_RECEIVED` → dodaje zaproszenie z „Sent At”
 *     (data wg czasu warszawskiego, północ; treść zaproszenia).
 *  3. Kontakt nie istnieje → zakłada go (`source = LINKEDIN_EXPORT`, `direction` wg Invitations.csv, domyślnie OUTBOUND) ze zdarzeniami z pkt 1 i 2.
 *  4. Osoba z `ACCEPTED`, ale bez zdarzenia zaproszenia → zdarzenie zaproszenia (`INVITE_SENT`, dla INBOUND `INVITE_RECEIVED`) z datą `ACCEPTED`
 *     i `dateUnknown = true` (nie psuje średnich czasu, spec 11).
 *  5. Puste pola istniejących kontaktów (e-mail, stanowisko) uzupełnia z Connections.csv. Niczego nie nadpisuje.
 *  6. `--relabel` (osobny tryb): kontaktom założonym tym importem 2026-11-24 (`source = IMPORT`, adres w eksporcie, `createdAt` od 2026-11-24)
 *     ustawia `source = LINKEDIN_EXPORT` (jednorazowo, po migracji dodającej wartość enuma; na sucho domyślnie, `--apply` wykonuje).
 * Nie zmienia istniejących dat ani treści, nie archiwizuje, nie usuwa. Zdarzenia przez `addEventTx` (etap, automatyzacje), jeden wspólny wpis
 * w dzienniku (`import.linkedin_export`). Uwaga: nowe `INVITE_SENT` zamyka otwarte przypomnienia RECONNECT kontaktu (automatyzacja aplikacji).
 */
import { join } from "node:path";
import { addEventTx } from "../lib/contact-events";
import { logActivity } from "../lib/activity-log";
import { warsawToUtc } from "../lib/dates";
import { prisma } from "../lib/prisma";
import { normalizeProfileUrl } from "../lib/profile-url";
import { dayWarsaw, loadCsv, loadSnapshot, parseConnectedOn, parseSentAt } from "./linkedin-export-core";

const apply = process.argv.includes("--apply");
const fromApi = process.argv.includes("--api");
const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(process.cwd(), fromApi ? "_linkedin-probe" : "_linkedin-probe/export/unpacked");
const sourceName = fromApi ? "API LinkedIn" : "eksport";

function loadRows(domain: "CONNECTIONS" | "INVITATIONS", csv: string): Record<string, string>[] {
  if (!fromApi) return loadCsv(dir, csv);
  const s = loadSnapshot(dir, domain);
  const savedAt = s.savedAt.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
  console.log(`API ${domain}: ${s.raw} rekordów, po usunięciu powtórek ${s.rows.length} (pobrano ${savedAt})`);
  return s.rows;
}

type Person = {
  url: string;
  name: string;
  email: string | null;
  occupation: string | null;
  connectedOn: string | null; // YYYY-MM-DD
  invite: { dir: "OUTGOING" | "INCOMING"; at: Date; message: string | null } | null;
};

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const dayToUtc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return warsawToUtc(y, m, d);
};

function collect(): { people: Map<string, Person>; own: string | null; skipped: number } {
  const people = new Map<string, Person>();
  let skipped = 0;
  for (const r of loadRows("CONNECTIONS", "Connections.csv")) {
    const url = normalizeProfileUrl(r["URL"]);
    const name = clean(`${clean(r["First Name"])} ${clean(r["Last Name"])}`);
    if (!url || !name) {
      skipped++;
      continue;
    }
    const co = parseConnectedOn(r["Connected On"]);
    const prev = people.get(url);
    const occ = [clean(r["Position"]), clean(r["Company"])].filter(Boolean).join(", ") || null;
    people.set(url, {
      url,
      name: prev?.name ?? name,
      email: prev?.email ?? (clean(r["Email Address"]) || null),
      occupation: prev?.occupation ?? occ,
      connectedOn: prev?.connectedOn && co ? (prev.connectedOn < co ? prev.connectedOn : co) : (prev?.connectedOn ?? co),
      invite: null,
    });
  }
  // własny adres: najczęstszy „inviter” przy OUTGOING
  const inv = loadRows("INVITATIONS", "Invitations.csv");
  const freq = new Map<string, number>();
  for (const r of inv) {
    const u = normalizeProfileUrl(r["Direction"] === "OUTGOING" ? r["inviterProfileUrl"] : r["inviteeProfileUrl"]);
    if (u) freq.set(u, (freq.get(u) ?? 0) + 1);
  }
  const own = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  for (const r of inv) {
    const out = r["Direction"] === "OUTGOING";
    const url = normalizeProfileUrl(out ? r["inviteeProfileUrl"] : r["inviterProfileUrl"]);
    const at = parseSentAt(r["Sent At"]);
    const name = clean(out ? r["To"] : r["From"]);
    if (!url || url === own || !at) {
      skipped++;
      continue;
    }
    const p = people.get(url) ?? { url, name, email: null, occupation: null, connectedOn: null, invite: null };
    if (!p.name) p.name = name;
    p.invite = { dir: out ? "OUTGOING" : "INCOMING", at, message: clean(r["Message"]) ? r["Message"].trim() : null };
    people.set(url, p);
  }
  return { people, own, skipped };
}

async function relabel() {
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"} · przypisanie źródła LINKEDIN_EXPORT`);
  const { people } = collect();
  const where = { source: "IMPORT" as const, profileUrl: { in: [...people.keys()] }, createdAt: { gte: new Date("2026-11-24T00:00:00+01:00") } };
  const n = await prisma.contact.count({ where });
  console.log(`Kontaktów do przepisania (IMPORT → LINKEDIN_EXPORT): ${n}`);
  if (!apply) return console.log("Na sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");
  const r = await prisma.contact.updateMany({ where, data: { source: "LINKEDIN_EXPORT" } });
  console.log(`Zmieniono: ${r.count}`);
  await logActivity({ source: "SYNC", action: "import.linkedin_export_relabel", summary: `Źródło kontaktów z eksportu LinkedIn: IMPORT → LINKEDIN_EXPORT (${r.count})`, details: { count: r.count } });
}

async function main() {
  if (process.argv.includes("--relabel")) return relabel();
  console.log(`Baza: ${new URL(process.env.DATABASE_URL!).host} · tryb: ${apply ? "WYKONANIE" : "na sucho"}`);
  const { people, own, skipped } = collect();
  console.log(`Źródło: ${sourceName}, ${people.size} osób (pominięte wiersze bez adresu/nazwy/daty: ${skipped}${own ? "" : ", UWAGA: nie ustalono własnego adresu"})`);

  const contacts = await prisma.contact.findMany({
    select: { id: true, profileUrl: true, direction: true, email: true, occupation: true, archived: true, events: { where: { type: { in: ["INVITE_SENT", "INVITE_RECEIVED", "ACCEPTED"] } }, select: { type: true } } },
  });
  const byUrl = new Map(contacts.map((c) => [c.profileUrl, c]));
  const openReconnect = new Set((await prisma.reminder.findMany({ where: { kind: "RECONNECT", status: "OPEN" }, select: { contactId: true } })).map((r) => r.contactId));

  type Plan = { person: Person; contactId: string | null; direction: "OUTBOUND" | "INBOUND"; invite: { type: "INVITE_SENT" | "INVITE_RECEIVED"; at: Date; message: string | null; dateUnknown: boolean } | null; accepted: Date | null; fillEmail: string | null; fillOccupation: string | null };
  const plans: Plan[] = [];
  for (const p of people.values()) {
    const c = byUrl.get(p.url);
    const has = (t: string) => !!c?.events.some((e) => e.type === t);
    const direction: "OUTBOUND" | "INBOUND" = c?.direction ?? (p.invite?.dir === "INCOMING" ? "INBOUND" : "OUTBOUND");
    const inviteType = direction === "INBOUND" ? "INVITE_RECEIVED" : "INVITE_SENT";
    const needAccepted = !!p.connectedOn && !has("ACCEPTED");
    const hasInvite = has("INVITE_SENT") || has("INVITE_RECEIVED");
    let invite: Plan["invite"] = null;
    if (!hasInvite) {
      if (p.invite) invite = { type: p.invite.dir === "INCOMING" ? "INVITE_RECEIVED" : "INVITE_SENT", at: dayToUtc(dayWarsaw(p.invite.at)), message: p.invite.message, dateUnknown: false };
      else if (needAccepted) invite = { type: inviteType, at: dayToUtc(p.connectedOn!), message: null, dateUnknown: true };
    }
    const fillEmail = c && !c.email?.trim() && p.email ? p.email : null;
    const fillOccupation = c && !c.occupation?.trim() && p.occupation ? p.occupation : null;
    if (!c || needAccepted || invite || fillEmail || fillOccupation) {
      plans.push({ person: p, contactId: c?.id ?? null, direction, invite, accepted: needAccepted ? dayToUtc(p.connectedOn!) : null, fillEmail, fillOccupation });
    }
  }

  const created = plans.filter((x) => !x.contactId);
  const existing = plans.filter((x) => x.contactId);
  const n = (a: Plan[], f: (x: Plan) => boolean) => a.filter(f).length;
  const anomalies = plans.filter((x) => x.invite && !x.invite.dateUnknown && x.accepted && x.invite.at > x.accepted).length;
  console.log(`\nDo zrobienia: ${plans.length} osób (nowe kontakty ${created.length}, istniejące do uzupełnienia ${existing.length})`);
  console.log(`  nowe: INBOUND ${n(created, (x) => x.direction === "INBOUND")}, z Invitations.csv ${n(created, (x) => !!x.person.invite)}, z samego Connections (sztuczne zaproszenie dateUnknown) ${n(created, (x) => !!x.invite?.dateUnknown)}, tylko zaproszenie bez przyjęcia ${n(created, (x) => !x.accepted)}`);
  console.log(`  istniejące: + ACCEPTED ${n(existing, (x) => !!x.accepted)}, + zaproszenie ${n(existing, (x) => !!x.invite)} (w tym sztuczne dateUnknown ${n(existing, (x) => !!x.invite?.dateUnknown)}), + e-mail ${n(existing, (x) => !!x.fillEmail)}, + stanowisko ${n(existing, (x) => !!x.fillOccupation)}`);
  console.log(`  zdarzeń do dodania: ${plans.reduce((s, x) => s + (x.invite ? 1 : 0) + (x.accepted ? 1 : 0), 0)}; zaproszenie PÓŹNIEJSZE niż przyjęcie (dziwne daty): ${anomalies}`);
  console.log(`  istniejące kontakty z nowym INVITE_SENT i otwartym przypomnieniem RECONNECT (zostanie zamknięte): ${n(existing, (x) => x.invite?.type === "INVITE_SENT" && openReconnect.has(x.contactId!))}`);
  console.log(`  istniejące zarchiwizowane objęte zmianą: ${existing.filter((x) => byUrl.get(x.person.url)!.archived).length}`);
  const years = new Map<string, number>();
  for (const x of created) if (x.accepted) years.set(x.person.connectedOn!.slice(0, 4), (years.get(x.person.connectedOn!.slice(0, 4)) ?? 0) + 1);
  console.log(`  nowe z przyjęciem wg roku „Connected On”: ${JSON.stringify(Object.fromEntries([...years].sort()))}`);

  if (!apply) return console.log("\nNa sucho: nic nie zmieniono. Dodaj --apply, żeby wykonać.");

  let doneContacts = 0, doneEvents = 0, filled = 0, failed = 0;
  for (const x of plans) {
    try {
      await prisma.$transaction(async (tx) => {
        let id = x.contactId;
        if (!id) {
          const c = await tx.contact.create({
            data: { profileUrl: x.person.url, name: x.person.name, occupation: x.person.occupation, email: x.person.email, direction: x.direction, source: "LINKEDIN_EXPORT" },
            select: { id: true },
          });
          id = c.id;
          doneContacts++;
        } else if (x.fillEmail || x.fillOccupation) {
          await tx.contact.update({ where: { id }, data: { ...(x.fillEmail ? { email: x.fillEmail } : {}), ...(x.fillOccupation ? { occupation: x.fillOccupation } : {}) } });
          filled++;
        }
        if (x.invite) {
          const r = await addEventTx(tx, id, { type: x.invite.type, occurredAt: x.invite.at, message: x.invite.message, dateUnknown: x.invite.dateUnknown }, { skipLog: true });
          if (!r.ok) throw new Error("zaproszenie: " + r.error);
          doneEvents++;
        }
        if (x.accepted) {
          const r = await addEventTx(tx, id, { type: "ACCEPTED", occurredAt: x.accepted }, { skipLog: true });
          if (!r.ok) throw new Error("przyjęcie: " + r.error);
          doneEvents++;
        }
      });
    } catch (e) {
      failed++;
      console.log(`  błąd (pominięto osobę): ${e instanceof Error ? e.message.slice(0, 120) : "nieznany"}`);
    }
  }
  console.log(`\nWykonano: nowych kontaktów ${doneContacts}, zdarzeń ${doneEvents}, uzupełnionych pól u istniejących ${filled}, błędów ${failed}`);
  await logActivity({
    source: "SYNC",
    action: "import.linkedin_export",
    level: failed ? "WARN" : "INFO",
    summary: `Import z LinkedIn (${fromApi ? "API" : "eksport CSV"}): nowych kontaktów ${doneContacts}, zdarzeń ${doneEvents}, uzupełnionych ${filled}, błędów ${failed}`,
    details: { contacts: doneContacts, events: doneEvents, filled, failed, from: fromApi ? "api" : "csv" },
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
