"use server";

import type { ArchiveReason, EventType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { normalizeThreadUrl } from "@/lib/calendar-parse";
import { addContactEvent, deleteContactEvent, setArchived, setOpenToWork, updateContactDetails } from "@/lib/contact-events";
import { normalizeProfileUrl } from "@/lib/profile-url";
import { VIEWED_UNKNOWN_DATE } from "@/lib/viewed";
import { refererListQuery } from "@/lib/list-context";
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

async function done(id: string, error?: string, extra?: Record<string, string>): Promise<never> {
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
  const from = await refererListQuery();
  const qs = [from ? `from=${encodeURIComponent(from)}` : "", error ? `error=${error}` : "", ...Object.entries(extra ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)].filter(Boolean).join("&");
  redirect(qs ? `/contacts/${id}?${qs}` : `/contacts/${id}`);
}

export async function addEventAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);

  const type = text(formData.get("type"), 40) as EventType | null;
  if (!type || !ALL_EVENT_TYPES.includes(type)) await done(id, "type");

  const occurredAt = parseDateInput(text(formData.get("date"), 10) ?? "");
  if (!occurredAt) await done(id, "date");

  const scheduledRaw = text(formData.get("scheduledAt"), 16);
  const scheduledAt = scheduledRaw ? parseDateTimeInput(scheduledRaw) : null;
  if (scheduledRaw && !scheduledAt) await done(id, "date");

  const result = await addContactEvent(id, {
    type: type!,
    occurredAt: occurredAt!,
    // nietknięta podpowiedź treści należy tylko do kroku, dla którego ją przygotowano (np. nie do "Zaproszenie wycofane")
    message: formData.get("suggestionUntouched") === "1" && text(formData.get("suggestedFor"), 40) !== type ? null : text(formData.get("message"), 5000),
    // termin spotkania ma sens tylko dla BOM umówionego i follow-upu (trafiają do kalendarza)
    scheduledAt: type === "BOM_SCHEDULED" || type === "FOLLOW_UP" ? scheduledAt : null,
  }, { skipFollowUps: formData.get("standardReminders") === "0" });
  await done(id, result.ok ? undefined : result.error);
}

export async function deleteEventAction(formData: FormData) {
  await requireAccess();
  const eventId = text(formData.get("eventId"), 64);
  if (!eventId) notFound();
  const result = await deleteContactEvent(eventId);
  if (!result.ok && result.error === "not-found") notFound();
  if (!result.ok) {
    const owner = await prisma.contactEvent.findUnique({ where: { id: eventId }, select: { contactId: true } });
    await done(owner!.contactId, result.error);
  }
  await done(result.ok ? result.contactId : "");
}

/** Ręczne „Viewed”: dodaje zdarzenie tylko gdy kontaktu jeszcze nie ma (podwójne kliknięcie nie dubluje). Data nieznana: znacznik 2000-01-01. */
export async function markViewedAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);
  const has = await prisma.contactEvent.count({ where: { contactId: id, type: "VIEWED_MY_PROFILE" } });
  if (!has) await addContactEvent(id, { type: "VIEWED_MY_PROFILE", occurredAt: VIEWED_UNKNOWN_DATE, dateUnknown: true });
  await done(id);
}

export async function archiveAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);
  const reason = text(formData.get("reason"), 30) as ArchiveReason | null;
  if (!reason || !ARCHIVE_REASONS.some((r) => r.value === reason)) await done(id, "reason");
  await setArchived(id, reason, { cancelReminders: formData.get("cancelReminders") === "on" });
  await done(id);
}

export async function unarchiveAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);
  await setArchived(id, null);
  await done(id);
}

export async function toggleOpenToWorkAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);
  await setOpenToWork(id, formData.get("value") === "1");
  await done(id);
}

export async function updateDetailsAction(formData: FormData) {
  await requireAccess();
  const id = await contactIdFrom(formData);
  // adres wątku LinkedIn: puste = brak, niepoprawny = błąd (nic nie zapisujemy)
  const threadUrl = normalizeThreadUrl(text(formData.get("threadUrl"), 500));
  if (threadUrl === null) await done(id, "thread");
  // adres profilu = klucz unikalności kontaktu: normalizujemy (spec 6.1), pusty = bez zmiany, zajęty przez inny kontakt = błąd
  const profileRaw = text(formData.get("profileUrl"), 500);
  const profileUrl = profileRaw ? normalizeProfileUrl(profileRaw) : null;
  if (profileRaw && !profileUrl) await done(id, "profile");
  if (profileUrl) {
    const taken = await prisma.contact.findFirst({ where: { profileUrl, id: { not: id } }, select: { id: true } });
    if (taken) await done(id, "profile-taken", { taken: taken.id });
  }
  await updateContactDetails(id, {
    name: text(formData.get("name"), 200), // puste pole = bez zmiany imienia
    profileUrl,
    occupation: text(formData.get("occupation"), 300),
    location: text(formData.get("location"), 200),
    threadUrl: threadUrl || null,
    salutation: text(formData.get("salutation"), 100),
    email: text(formData.get("email"), 200),
    phone: text(formData.get("phone"), 50),
    info: text(formData.get("info"), 10000),
  }, { applyLocationToAll: formData.get("applyLocationToAll") === "on" });
  await done(id);
}
