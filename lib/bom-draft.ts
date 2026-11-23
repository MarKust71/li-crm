import { prisma } from "./prisma";
import { MEETING_TYPES, OUTCOME_TYPES, meetingOutcome } from "./meeting-sync-core";
import { BOM_DRAFT_WINDOW_HOURS, bomDraftKey, buildBomDraft, buildRawMime } from "./bom-draft-core";
import { getMeetingLink } from "./settings";

export type BomDraftOut = { key: string; to: string; name: string; subject: string; raw: string; when: string };

const ZOOM_FALLBACK = "https://zoom.us/j/2581716586";

/**
 * Szkice e-maili do utworzenia teraz: świeżo umówione (zdarzenie BOM_SCHEDULED dodane w ostatnich 24 h), jeszcze otwarte,
 * z terminem w przyszłości i kontaktem z e-mailem. Nic nie zapisuje: szkic liczy się jako utworzony po potwierdzeniu (recordSent z lib/notify).
 */
export async function getPendingBomDrafts(now = new Date()): Promise<BomDraftOut[]> {
  const events = await prisma.contactEvent.findMany({
    where: {
      type: MEETING_TYPES[0],
      scheduledAt: { gt: now },
      createdAt: { gte: new Date(now.getTime() - BOM_DRAFT_WINDOW_HOURS * 3_600_000) },
      contact: { email: { not: null }, archived: false },
    },
    orderBy: { createdAt: "asc" },
    include: { contact: { select: { name: true, salutation: true, email: true } } },
  });
  if (!events.length) return [];

  const keys = events.map((e) => bomDraftKey(e.id, e.scheduledAt!));
  const done = new Set((await prisma.sentNotification.findMany({ where: { key: { in: keys } }, select: { key: true } })).map((k) => k.key));
  const hist = await prisma.contactEvent.findMany({
    where: { contactId: { in: [...new Set(events.map((e) => e.contactId))] }, type: { in: ["BOM_SCHEDULED", ...OUTCOME_TYPES] } },
    select: { id: true, contactId: true, type: true, occurredAt: true, createdAt: true },
  });
  const link = (await getMeetingLink()) ?? ZOOM_FALLBACK;

  const out: BomDraftOut[] = [];
  events.forEach((e, i) => {
    const to = e.contact.email?.trim();
    if (!to || done.has(keys[i])) return;
    if (meetingOutcome(e.id, hist.filter((h) => h.contactId === e.contactId)) !== "open") return;
    const d = buildBomDraft({ scheduledAt: e.scheduledAt!, salutation: e.contact.salutation, link });
    out.push({ key: keys[i], to, name: e.contact.name, subject: d.subject, raw: buildRawMime(to, d.subject, d.html), when: d.when });
  });
  return out;
}
