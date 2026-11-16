import type { ArchiveReason, EventType, Prisma } from "@prisma/client";
import { contactName, logActivity } from "./activity-log";
import { EVENT_LABEL } from "./labels";
import { prisma } from "./prisma";
import { applyEventAutomations } from "./reminders";
import { MEETING_TYPES, OUTCOME_TYPES } from "./meeting-sync-core";
import { computeStage } from "./stage";

// Jedyne miejsce zapisu zdarzeń: każde dodanie/usunięcie przelicza Contact.stage (CLAUDE.md).

async function recomputeStage(tx: Prisma.TransactionClient, contactId: string) {
  const events = await tx.contactEvent.findMany({ where: { contactId }, select: { type: true } });
  await tx.contact.update({ where: { id: contactId }, data: { stage: computeStage(events) } });
}

export type EventResult = { ok: true } | { ok: false; error: "no-bom" | "no-schedule" };

/** Dane synchronizacji z kalendarzem przy tworzeniu zdarzenia na podstawie wydarzenia (patrz lib/calendar-sync.ts). */
export type EventSyncData = {
  googleEventId: string;
  googleCalendarId: string;
  calendarTitle: string;
  durationMinutes: number;
  calendarUpdatedAt: Date | null;
};

const isMeetingType = (t: EventType) => (MEETING_TYPES as readonly string[]).includes(t);
const affectsMeetings = (t: EventType) => isMeetingType(t) || (OUTCOME_TYPES as readonly string[]).includes(t);

/** Zmiana w historii kontaktu może zmienić tytuł/stan wydarzeń spotkań, więc oznacz je do wysłania do kalendarza. */
async function markMeetingsPending(tx: Prisma.TransactionClient, contactId: string) {
  await tx.contactEvent.updateMany({
    where: { contactId, type: { in: [...MEETING_TYPES] }, scheduledAt: { not: null } },
    data: { syncState: "PENDING", syncAttempts: 0, syncError: null },
  });
}

/**
 * Zapis zdarzenia w transakcji. Zasady: FOLLOW_UP wymaga terminu i odbytego BOM (BOM_COMPLETED); BOM_SCHEDULED wymaga terminu.
 * `fromCalendar` = zdarzenie pochodzi z kalendarza, więc nie oznaczamy spotkań do ponownego wysłania.
 */
export async function addEventTx(
  tx: Prisma.TransactionClient,
  contactId: string,
  data: { type: EventType; occurredAt: Date; message?: string | null; scheduledAt?: Date | null; sync?: EventSyncData },
  opts: { fromCalendar?: boolean; /** pomija wpis w dzienniku (np. import zbiorczy zapisuje jedno podsumowanie) */ skipLog?: boolean } = {},
): Promise<EventResult> {
  if (isMeetingType(data.type) && !data.scheduledAt) return { ok: false, error: "no-schedule" };
  if (data.type === "FOLLOW_UP") {
    const bom = await tx.contactEvent.count({ where: { contactId, type: "BOM_COMPLETED" } });
    if (bom === 0) return { ok: false, error: "no-bom" };
  }
  await tx.contactEvent.create({
    data: {
      contactId,
      type: data.type,
      occurredAt: data.occurredAt,
      message: data.message ?? null,
      scheduledAt: isMeetingType(data.type) ? (data.scheduledAt ?? null) : null,
      ...(data.sync ? { ...data.sync, syncState: "SYNCED" as const } : {}),
    },
  });
  await recomputeStage(tx, contactId);
  await applyEventAutomations(tx, contactId, data.type, data.occurredAt);
  if (!opts.skipLog) await logActivity(
    {
      source: opts.fromCalendar ? "SYNC" : "UI",
      action: "event.added",
      contactId,
      summary: `${EVENT_LABEL[data.type]}: ${await contactName(contactId, tx)}${opts.fromCalendar ? " (z kalendarza)" : ""}`,
      details: { type: data.type, occurredAt: data.occurredAt.toISOString(), ...(data.scheduledAt ? { scheduledAt: data.scheduledAt.toISOString() } : {}) },
    },
    tx,
  );
  if (!opts.fromCalendar && affectsMeetings(data.type)) await markMeetingsPending(tx, contactId);
  return { ok: true };
}

export async function addContactEvent(
  contactId: string,
  data: { type: EventType; occurredAt: Date; message?: string | null; scheduledAt?: Date | null },
): Promise<EventResult> {
  return prisma.$transaction((tx) => addEventTx(tx, contactId, data));
}

export type DeleteResult = { ok: true; contactId: string } | { ok: false; error: "not-found" | "has-follow-up" };

/** Usunięcie zdarzenia. Powiązane wydarzenie w kalendarzu zostaje usunięte przez synchronizację ("nagrobek"). */
export async function deleteContactEvent(eventId: string): Promise<DeleteResult> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.contactEvent.findUnique({ where: { id: eventId }, select: { contactId: true, type: true, occurredAt: true, googleEventId: true, googleCalendarId: true } });
    if (!event) return { ok: false, error: "not-found" } as const;
    if (event.type === "BOM_COMPLETED") {
      // FU nie może istnieć bez odbytego BOM
      const [completed, followUps] = await Promise.all([
        tx.contactEvent.count({ where: { contactId: event.contactId, type: "BOM_COMPLETED" } }),
        tx.contactEvent.count({ where: { contactId: event.contactId, type: "FOLLOW_UP" } }),
      ]);
      if (completed === 1 && followUps > 0) return { ok: false, error: "has-follow-up" } as const;
    }
    await tx.contactEvent.delete({ where: { id: eventId } });
    if (isMeetingType(event.type) && event.googleEventId && event.googleCalendarId) {
      await tx.calendarTombstone.upsert({
        where: { googleCalendarId_googleEventId: { googleCalendarId: event.googleCalendarId, googleEventId: event.googleEventId } },
        create: { googleCalendarId: event.googleCalendarId, googleEventId: event.googleEventId },
        update: { syncState: "PENDING", syncAttempts: 0, syncError: null },
      });
    }
    await recomputeStage(tx, event.contactId);
    await logActivity(
      { source: "UI", action: "event.deleted", contactId: event.contactId, summary: `Usunięto zdarzenie „${EVENT_LABEL[event.type]}": ${await contactName(event.contactId, tx)}`, details: { type: event.type, occurredAt: event.occurredAt.toISOString() } },
      tx,
    );
    if (affectsMeetings(event.type)) await markMeetingsPending(tx, event.contactId);
    return { ok: true, contactId: event.contactId } as const;
  });
}

export async function setArchived(contactId: string, reason: ArchiveReason | null, opts: { cancelReminders?: boolean } = {}) {
  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contactId },
      data: reason
        ? { archived: true, archiveReason: reason, archivedAt: new Date() }
        : { archived: false, archiveReason: null, archivedAt: null },
    });
    // Anulowanie zostawia wiersze (CANCELED), a synchronizacja sama usuwa ich wydarzenia z kalendarza Google.
    const canceled =
      reason && opts.cancelReminders
        ? (await tx.reminder.updateMany({ where: { contactId, status: "OPEN" }, data: { status: "CANCELED", syncState: "PENDING", syncAttempts: 0, syncError: null } })).count
        : 0;
    await logActivity(
      {
        source: "UI",
        action: reason ? "contact.archived" : "contact.unarchived",
        contactId,
        summary: `${reason ? "Zarchiwizowano" : "Przywrócono z archiwum"}: ${await contactName(contactId, tx)}${canceled ? ` (anulowano ${canceled} przypomnień)` : ""}`,
        ...(reason ? { details: { reason, canceledReminders: canceled } } : {}),
      },
      tx,
    );
  });
}

export async function setOpenToWork(contactId: string, value: boolean) {
  await prisma.$transaction(async (tx) => {
    await tx.contact.update({ where: { id: contactId }, data: { openToWork: value } });
    await logActivity(
      { source: "UI", action: "contact.otw_changed", contactId, summary: `OTW ${value ? "włączone" : "wyłączone"}: ${await contactName(contactId, tx)}`, details: { from: !value, to: value } },
      tx,
    );
  });
}

export async function updateContactDetails(
  contactId: string,
  data: { /** null = bez zmiany (imię nie może być puste) */ name: string | null; occupation: string | null; location: string | null; threadUrl: string | null; salutation: string | null; email: string | null; phone: string | null; info: string | null },
  opts: { applyLocationToAll?: boolean } = {},
) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.contact.findUnique({ where: { id: contactId }, select: { name: true, occupation: true, location: true, threadUrl: true, salutation: true, email: true, phone: true, info: true } });
    const { name, ...rest } = data;
    await tx.contact.update({ where: { id: contactId }, data: { ...rest, ...(name ? { name } : {}) } });
    // w logu tylko nazwy zmienionych pól (e-mail i telefon to dane osobowe)
    const changed: string[] = (["occupation", "location", "threadUrl", "salutation", "email", "phone", "info"] as const).filter((k) => (before?.[k] ?? null) !== rest[k]);
    if (name && name !== before?.name) changed.unshift("name");
    if (changed.length) {
      await logActivity({ source: "UI", action: "contact.updated", contactId, summary: `Zmieniono dane kontaktu ${before?.name ?? ""}: ${changed.join(", ")}`, details: { fields: changed } }, tx);
    }

    // Zmiana lokalizacji dla wszystkich kontaktów z taką samą dotychczasową wartością (jak w arkuszach: "Wałbrzych, dolnośląskie" → "dolnośląskie").
    // Dopasowanie dokładne (bez rozróżniania wielkości liter), nie "zawiera", żeby krótki zapis nie zmienił setek innych.
    const old = before?.location?.trim() || null;
    if (opts.applyLocationToAll && old && (before?.location ?? null) !== data.location) {
      const res = await tx.contact.updateMany({ where: { id: { not: contactId }, location: { equals: old, mode: "insensitive" } }, data: { location: data.location } });
      if (res.count > 0) {
        await logActivity(
          {
            source: "UI",
            action: "contacts.location_bulk",
            contactId,
            summary: `Zmieniono lokalizację „${old}” → „${data.location ?? "(puste)"}” u ${res.count} innych kontaktów`,
            details: { from: old, to: data.location, count: res.count },
          },
          tx,
        );
      }
    }
  });
}

/** Ile innych kontaktów ma taką samą lokalizację (bez rozróżniania wielkości liter): do podpowiedzi przy edycji. */
export async function countSameLocation(contactId: string, location: string | null): Promise<number> {
  const old = location?.trim();
  if (!old) return 0;
  return prisma.contact.count({ where: { id: { not: contactId }, location: { equals: old, mode: "insensitive" } } });
}
