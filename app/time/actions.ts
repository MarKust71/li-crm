"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { parseDateTimeInput } from "@/lib/dates";
import { MAX_COUNT, deleteEntry, resolveActivityId, startSession, stopSession, updateEntry } from "@/lib/time";

const text = (v: FormDataEntryValue | null, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Czas z formularza, ale tylko jeśli użytkownik go zmienił względem wartości z chwili renderu. */
function changedTime(formData: FormData, field: string): { changed: false } | { changed: true; value: Date | null } {
  const raw = text(formData.get(field), 16);
  const initial = text(formData.get(`${field}Initial`), 16);
  if (raw === initial) return { changed: false };
  return { changed: true, value: raw ? parseDateTimeInput(raw) : null };
}

function done(error?: string, page?: string | null): never {
  // znaczek z licznikiem jest w nawigacji każdej strony, więc odśwież cały układ
  revalidatePath("/", "layout");
  const p = page && /^\d{1,4}$/.test(page) && page !== "1" ? `page=${page}` : "";
  const qs = [p, error ? `error=${error}` : ""].filter(Boolean).join("&");
  redirect(qs ? `/time?${qs}` : "/time");
}

/** Liczba sztuk: puste = brak, w przeciwnym razie liczba całkowita 0…MAX_COUNT. */
function parseCount(v: FormDataEntryValue | null): { ok: true; value: number | null } | { ok: false } {
  const t = text(v, 10);
  if (t === null) return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  return n <= MAX_COUNT ? { ok: true, value: n } : { ok: false };
}

async function activityFrom(formData: FormData) {
  return resolveActivityId(text(formData.get("activityId"), 64), text(formData.get("newActivity"), 100));
}

export async function startAction(formData: FormData) {
  await requireAccess();
  const result = await startSession(await activityFrom(formData));
  done(result.ok ? undefined : result.error);
}

export async function stopAction(formData: FormData) {
  await requireAccess();
  const page = text(formData.get("page"), 4);
  const id = text(formData.get("id"), 64);
  if (!id) done("notfound", page);

  const endRaw = text(formData.get("endedAt"), 16);
  const endedAt = endRaw ? parseDateTimeInput(endRaw) : new Date(); // puste = teraz (w chwili kliknięcia)
  const start = changedTime(formData, "startedAt");
  if (!endedAt || (start.changed && !start.value)) done("date", page);
  const count = parseCount(formData.get("count"));
  if (!count.ok) done("count", page);

  const result = await stopSession(id!, {
    startedAt: start.changed ? (start.value ?? undefined) : undefined,
    endedAt: endedAt!,
    activityId: await activityFrom(formData),
    count: count.ok ? count.value : null,
    note: text(formData.get("note"), 2000),
  });
  done(result.ok ? undefined : result.error, page);
}

export async function updateEntryAction(formData: FormData) {
  await requireAccess();
  const page = text(formData.get("page"), 4);
  const id = text(formData.get("id"), 64);
  if (!id) done("notfound", page);

  const start = changedTime(formData, "startedAt");
  const end = changedTime(formData, "endedAt");
  if ((start.changed && !start.value) || (end.changed && !end.value)) done("date", page);
  const count = parseCount(formData.get("count"));
  if (!count.ok) done("count", page);

  const result = await updateEntry(id!, {
    startedAt: start.changed ? (start.value ?? undefined) : undefined,
    endedAt: end.changed ? (end.value ?? undefined) : undefined,
    activityId: await activityFrom(formData),
    count: count.ok ? count.value : null,
    note: text(formData.get("note"), 2000),
  });
  done(result.ok ? undefined : result.error, page);
}

export async function deleteEntryAction(formData: FormData) {
  await requireAccess();
  const id = text(formData.get("entryId"), 64);
  if (!id) done("notfound");
  const result = await deleteEntry(id!);
  done(result.ok ? undefined : result.error, text(formData.get("page"), 4));
}
