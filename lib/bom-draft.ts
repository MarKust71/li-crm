import { after } from "next/server";
import { logActivity } from "./activity-log";
import { prisma } from "./prisma";
import { MEETING_TYPES, OUTCOME_TYPES, meetingOutcome } from "./meeting-sync-core";
import { bomDraftKey, buildBomDraft, buildRawMime } from "./bom-draft-core";
import { recordSent } from "./notify";
import { getMeetingLink } from "./settings";

const ZOOM_FALLBACK = "https://zoom.us/j/2581716586";
const TIMEOUT_MS = 20_000;

/**
 * Prosi n8n o szkice e-maili po umówieniu BOM. Wołane po zapisie (po odpowiedzi dla użytkownika), gdy zmienia się cokolwiek, co mail pokazuje:
 * dodanie `BOM_SCHEDULED`, jego termin, e-mail lub zwrot kontaktu, „Domyślny link BOM”. Każda zmiana treści daje NOWY szkic (starego nie ruszamy,
 * zdarzenie nie jest powiązane ze szkicem). Bez `BOM_DRAFT_WEBHOOK_URL` nic nie robi (lokalnie nie wołamy n8n z prawdziwymi danymi).
 * Szkic powstaje, gdy BOM jest otwarty, termin w przyszłości, a kontakt ma e-mail i nie jest zarchiwizowany.
 * Idempotencja: `SentNotification` z kluczem z odcisku treści (`bomDraftKey`), zapisywany dopiero po potwierdzeniu przez n8n.
 */
function defer(job: () => Promise<unknown>): void {
  if (!process.env.BOM_DRAFT_WEBHOOK_URL) return;
  const run = () => job().catch((e) => console.error("bom-draft:", e instanceof Error ? e.message : e));
  try {
    after(run); // po zatwierdzeniu transakcji i wysłaniu odpowiedzi
  } catch {
    void run(); // poza żądaniem (skrypty)
  }
}

/** Nowo dodany lub przełożony BOM. */
export const scheduleBomDraft = (eventId: string) => defer(() => requestBomDraft(eventId));

/** Zmiana e-maila lub zwrotu kontaktu: szkice dla jego nadchodzących BOM (także pierwszy, gdy e-mail właśnie doszedł). */
export const scheduleBomDraftsForContact = (contactId: string) => defer(() => requestBomDrafts({ contactId }));

/** Zmiana „Domyślnego linku BOM”: nowe szkice tylko dla nadchodzących BOM, które już dostały szkic (żeby nie zasypać skrzynki). */
export const scheduleBomDraftsForLinkChange = () => defer(() => requestBomDrafts({ onlyIfDrafted: true }));

async function requestBomDrafts(opts: { contactId?: string; onlyIfDrafted?: boolean }, now = new Date()) {
  const events = await prisma.contactEvent.findMany({
    where: { type: MEETING_TYPES[0], scheduledAt: { gt: now }, ...(opts.contactId ? { contactId: opts.contactId } : {}) },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
  });
  for (const e of events) {
    if (opts.onlyIfDrafted && !(await prisma.sentNotification.findFirst({ where: { key: { startsWith: `bomdraft:${e.id}:` } }, select: { key: true } }))) continue;
    await requestBomDraft(e.id, now).catch((err) => console.error("bom-draft:", err instanceof Error ? err.message : err));
  }
}

export async function requestBomDraft(eventId: string, now = new Date()): Promise<"sent" | "skipped" | "failed"> {
  const url = process.env.BOM_DRAFT_WEBHOOK_URL;
  if (!url) return "skipped";
  const e = await prisma.contactEvent.findUnique({
    where: { id: eventId },
    include: { contact: { select: { name: true, salutation: true, email: true, archived: true } } },
  });
  const to = e?.contact.email?.trim();
  if (!e || e.type !== MEETING_TYPES[0] || !e.scheduledAt || e.scheduledAt <= now || !to || e.contact.archived) return "skipped";

  const link = (await getMeetingLink()) ?? ZOOM_FALLBACK;
  const key = bomDraftKey(e.id, { scheduledAt: e.scheduledAt, to, salutation: e.contact.salutation, link });
  if (await prisma.sentNotification.findUnique({ where: { key }, select: { key: true } })) return "skipped";
  const hist = await prisma.contactEvent.findMany({
    where: { contactId: e.contactId, type: { in: ["BOM_SCHEDULED", ...OUTCOME_TYPES] } },
    select: { id: true, contactId: true, type: true, occurredAt: true, createdAt: true },
  });
  if (meetingOutcome(e.id, hist) !== "open") return "skipped";

  const draft = buildBomDraft({ scheduledAt: e.scheduledAt, salutation: e.contact.salutation, link });
  let ok = false;
  let error = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.BOM_DRAFT_API_KEY ? { "x-api-key": process.env.BOM_DRAFT_API_KEY } : {}) },
      body: JSON.stringify({ key, to, name: e.contact.name, when: draft.when, subject: draft.subject, raw: buildRawMime(to, draft.subject, draft.html) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    ok = res.ok && body?.ok === true;
    if (!ok) error = res.ok ? "n8n nie utworzył szkicu" : `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : "błąd połączenia";
  }
  if (ok) await recordSent([key]);
  // bez e-maila i treści w dzienniku
  await logActivity({
    source: "SYNC",
    level: ok ? undefined : "ERROR",
    action: ok ? "bomdraft.created" : "bomdraft.failed",
    contactId: e.contactId,
    summary: ok ? `Utworzono szkic e-maila po umówieniu BOM: ${e.contact.name}` : `Nie udało się utworzyć szkicu e-maila po umówieniu BOM: ${e.contact.name} (${error})`,
    details: { key },
  });
  return ok ? "sent" : "failed";
}
