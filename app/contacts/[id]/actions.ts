"use server";

import type { ArchiveReason, EventType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { addContactEvent, deleteContactEvent, setArchived, updateContactDetails } from "@/lib/contact-events";
import { prisma } from "@/lib/prisma";
import { ALL_EVENT_TYPES, ARCHIVE_REASONS } from "@/lib/labels";
import { parseDateInput, parseDateTimeInput } from "@/lib/dates";

const text = (v: FormDataEntryValue | null, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

async function contactIdFrom(formData: FormData): Promise<string> {
  const id = text(formData.get("id"), 64);
  if (!id) notFound();
  const exists = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
  if (!exists) notFound();
  return id;
}

function done(id: string, error?: string): never {
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
  redirect(error ? `/contacts/${id}?error=${error}` : `/contacts/${id}`);
}

export async function addEventAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);

  const type = text(formData.get("type"), 40) as EventType | null;
  if (!type || !ALL_EVENT_TYPES.includes(type)) done(id, "type");

  const occurredAt = parseDateInput(text(formData.get("date"), 10) ?? "");
  if (!occurredAt) done(id, "date");

  const scheduledRaw = text(formData.get("scheduledAt"), 16);
  const scheduledAt = scheduledRaw ? parseDateTimeInput(scheduledRaw) : null;
  if (scheduledRaw && !scheduledAt) done(id, "date");

  await addContactEvent(id, {
    type: type!,
    occurredAt: occurredAt!,
    message: text(formData.get("message"), 5000),
    // termin spotkania ma sens tylko dla BOM umówionego
    scheduledAt: type === "BOM_SCHEDULED" ? scheduledAt : null,
  });
  done(id);
}

export async function deleteEventAction(formData: FormData) {
  await requireAccess();
  const eventId = text(formData.get("eventId"), 64);
  if (!eventId) notFound();
  const contactId = await deleteContactEvent(eventId);
  if (!contactId) notFound();
  done(contactId);
}

export async function archiveAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);
  const reason = text(formData.get("reason"), 30) as ArchiveReason | null;
  if (!reason || !ARCHIVE_REASONS.some((r) => r.value === reason)) done(id, "reason");
  await setArchived(id, reason);
  done(id);
}

export async function unarchiveAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);
  await setArchived(id, null);
  done(id);
}

export async function updateDetailsAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);
  await updateContactDetails(id, {
    salutation: text(formData.get("salutation"), 100),
    email: text(formData.get("email"), 200),
    phone: text(formData.get("phone"), 50),
    info: text(formData.get("info"), 10000),
  });
  done(id);
}
