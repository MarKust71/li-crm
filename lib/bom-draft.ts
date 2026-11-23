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
 * Prosi n8n o szkic e-maila po umówieniu BOM. Wołane po zapisie (po odpowiedzi dla użytkownika), gdy BOM_SCHEDULED zostaje dodany
 * albo zmienia termin. Bez `BOM_DRAFT_WEBHOOK_URL` nic nie robi (lokalnie nie wołamy n8n z prawdziwymi danymi).
 * Szkic powstaje, gdy BOM jest otwarty, termin w przyszłości, a kontakt ma e-mail i nie jest zarchiwizowany.
 * Idempotencja: `SentNotification` z kluczem id+termin, zapisywany dopiero po potwierdzeniu przez n8n.
 */
export function scheduleBomDraft(eventId: string): void {
  if (!process.env.BOM_DRAFT_WEBHOOK_URL) return;
  const run = () => requestBomDraft(eventId).catch((e) => console.error("bom-draft:", e instanceof Error ? e.message : e));
  try {
    after(run); // po zatwierdzeniu transakcji i wysłaniu odpowiedzi
  } catch {
    void run(); // poza żądaniem (skrypty)
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

  const key = bomDraftKey(e.id, e.scheduledAt);
  if (await prisma.sentNotification.findUnique({ where: { key }, select: { key: true } })) return "skipped";
  const hist = await prisma.contactEvent.findMany({
    where: { contactId: e.contactId, type: { in: ["BOM_SCHEDULED", ...OUTCOME_TYPES] } },
    select: { id: true, contactId: true, type: true, occurredAt: true, createdAt: true },
  });
  if (meetingOutcome(e.id, hist) !== "open") return "skipped";

  const draft = buildBomDraft({ scheduledAt: e.scheduledAt, salutation: e.contact.salutation, link: (await getMeetingLink()) ?? ZOOM_FALLBACK });
  let ok = false;
  let error = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
