"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { addDays, parseDateInput, parseDateTimeInput, todayWarsaw } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { MAX_COUNT, deleteEntry, endRunningAt, resolveActivityId, startSession, stopSession, updateEntry } from "@/lib/time";

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

// ───────────────────────── pasek podpowiedzi i szybkie zatrzymanie (bez przekierowania: zostajemy na bieżącej stronie) ─────────────────────────

const MAX_LOOKBACK_MS = 12 * 3_600_000;
const iso = (v: FormDataEntryValue | null): Date | null => {
  const t = text(v, 40);
  const d = t ? new Date(t) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** Włącza rejestrowanie od podanej chwili (początek serii aktywności) albo od teraz. */
export async function startFromBarAction(formData: FormData) {
  await requireAccess();
  const now = new Date();
  let startedAt = formData.get("mode") === "from" ? iso(formData.get("from")) : null;
  if (startedAt) {
    // tylko sensowny początek: nie w przyszłości, nie starszy niż 12 h i nie wcześniej niż koniec poprzedniej sesji
    const lastEnd = (await prisma.timeEntry.aggregate({ _max: { endedAt: true } }))._max.endedAt;
    if (startedAt > now || now.getTime() - startedAt.getTime() > MAX_LOOKBACK_MS || (lastEnd && startedAt < lastEnd)) startedAt = null;
  }
  await startSession(await activityFrom(formData), startedAt ?? now);
  revalidatePath("/", "layout");
}

/** Zakończenie trwającej sesji o podanej chwili (np. ostatniej aktywności); puste = teraz. */
export async function stopFromBarAction(formData: FormData) {
  await requireAccess();
  const id = text(formData.get("id"), 64);
  const now = new Date();
  let endedAt = iso(formData.get("endedAt")) ?? now;
  if (endedAt > now) endedAt = now;
  if (id) await endRunningAt(id, endedAt);
  revalidatePath("/", "layout");
}

export type QuickStopState = { error?: string } | null;

const QUICK_STOP_ERRORS: Record<string, string> = {
  notfound: "Ta sesja już nie trwa.",
  end_before_start: "Koniec nie może być przed początkiem sesji.",
  date: "Niepoprawna data zakończenia.",
  count: "Liczba sztuk: liczba całkowita 0…" + MAX_COUNT + ".",
};

/** Zatrzymanie z okienka przy liczniku w nawigacji (godzina końca, czynność, liczba sztuk). */
export async function quickStopAction(_prev: QuickStopState, formData: FormData): Promise<QuickStopState> {
  await requireAccess();
  const id = text(formData.get("id"), 64);
  if (!id) return { error: QUICK_STOP_ERRORS.notfound };
  const endRaw = text(formData.get("endedAt"), 16);
  const endedAt = endRaw ? parseDateTimeInput(endRaw) : new Date();
  if (!endedAt) return { error: QUICK_STOP_ERRORS.date };
  if (endedAt.getTime() > Date.now() + 60_000) return { error: "Koniec nie może być w przyszłości." };
  const count = parseCount(formData.get("count"));
  if (!count.ok) return { error: QUICK_STOP_ERRORS.count };
  const entry = await prisma.timeEntry.findUnique({ where: { id }, select: { note: true } });
  const result = await stopSession(id, { endedAt, activityId: await activityFrom(formData), count: count.value, note: entry?.note ?? null });
  if (!result.ok) return { error: QUICK_STOP_ERRORS[result.error] ?? "Nie udało się zatrzymać sesji." };
  revalidatePath("/", "layout");
  return null;
}

/** "Nie teraz": ciasteczko z czasem wygaśnięcia ukrywa pasek na 2 godziny albo do końca dnia (czas warszawski). */
export async function snoozeTimeBarAction(formData: FormData) {
  await requireAccess();
  const kind = formData.get("kind") === "idle" ? "idle" : "start";
  const until =
    formData.get("mode") === "day" ? parseDateInput(addDays(todayWarsaw(), 1))!.getTime() : Date.now() + 2 * 3_600_000;
  (await cookies()).set(`li_snooze_${kind}`, String(until), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, Math.ceil((until - Date.now()) / 1000)),
  });
  revalidatePath("/", "layout");
}
