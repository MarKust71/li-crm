import type { ArchiveReason, EventType, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { computeStage } from "./stage";

// Jedyne miejsce zapisu zdarzeń: każde dodanie/usunięcie przelicza Contact.stage (CLAUDE.md).

async function recomputeStage(tx: Prisma.TransactionClient, contactId: string) {
  const events = await tx.contactEvent.findMany({ where: { contactId }, select: { type: true } });
  await tx.contact.update({ where: { id: contactId }, data: { stage: computeStage(events) } });
}

export async function addContactEvent(
  contactId: string,
  data: { type: EventType; occurredAt: Date; message?: string | null; scheduledAt?: Date | null },
) {
  await prisma.$transaction(async (tx) => {
    await tx.contactEvent.create({
      data: {
        contactId,
        type: data.type,
        occurredAt: data.occurredAt,
        message: data.message ?? null,
        scheduledAt: data.scheduledAt ?? null,
      },
    });
    await recomputeStage(tx, contactId);
  });
}

/** Zwraca contactId usuniętego zdarzenia albo null, gdy zdarzenie nie istnieje. */
export async function deleteContactEvent(eventId: string): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.contactEvent.findUnique({ where: { id: eventId }, select: { contactId: true } });
    if (!event) return null;
    await tx.contactEvent.delete({ where: { id: eventId } });
    await recomputeStage(tx, event.contactId);
    return event.contactId;
  });
}

export async function setArchived(contactId: string, reason: ArchiveReason | null) {
  await prisma.contact.update({
    where: { id: contactId },
    data: reason
      ? { archived: true, archiveReason: reason, archivedAt: new Date() }
      : { archived: false, archiveReason: null, archivedAt: null },
  });
}

export async function updateContactDetails(
  contactId: string,
  data: { salutation: string | null; email: string | null; phone: string | null; info: string | null },
) {
  await prisma.contact.update({ where: { id: contactId }, data });
}
