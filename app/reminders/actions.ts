"use server";

import type { ReminderKind } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { addDays, addDelay, todayWarsaw, type DelayUnit } from "@/lib/dates";
import {
  RECONNECT_DAYS,
  cancelReminder,
  completeReminder,
  createReminder,
  reopenReminder,
  rescheduleReminder,
  type ReminderResult,
} from "@/lib/reminders";

const text = (v: FormDataEntryValue | null, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Adres powrotu tylko z listy dozwolonych (lista "Dziś" albo karta kontaktu), żeby nie dało się przekierować gdziekolwiek. */
function safeBack(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(?:today(?:\?page=\d{1,4})?|contacts\/[A-Za-z0-9_-]{1,64})$/.test(s) ? s : "/today";
}

function done(back: string, result?: ReminderResult): never {
  revalidatePath("/", "layout");
  const error = result && !result.ok ? result.error : null;
  redirect(error ? `${back}${back.includes("?") ? "&" : "?"}error=${error}` : back);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS: DelayUnit[] = ["days", "weeks", "months"];

export async function createReminderAction(formData: FormData) {
  await requireAccess();
  const back = safeBack(formData.get("back"));
  const contactId = text(formData.get("contactId"), 64);
  if (!contactId) done(back, { ok: false, error: "notfound" });

  const kind: ReminderKind = formData.get("kind") === "RECONNECT" ? "RECONNECT" : "REMINDER";
  const today = todayWarsaw();
  let dueDate: string;
  if (kind === "RECONNECT") {
    dueDate = addDays(today, RECONNECT_DAYS); // stały okres wynika z zasad LinkedIn
  } else {
    const exact = text(formData.get("dueDate"), 10);
    if (exact) {
      if (!DATE_RE.test(exact)) done(back, { ok: false, error: "date" });
      dueDate = exact!;
    } else {
      const n = Number(text(formData.get("delayNumber"), 5));
      const unit = text(formData.get("delayUnit"), 10) as DelayUnit | null;
      if (!Number.isInteger(n) || n < 1 || n > 3650 || !unit || !UNITS.includes(unit)) done(back, { ok: false, error: "delay" });
      dueDate = addDelay(today, n, unit!);
    }
  }
  done(back, await createReminder({ contactId: contactId!, kind, dueDate, note: text(formData.get("note"), 2000), source: "APP" }));
}

export async function completeReminderAction(formData: FormData) {
  await requireAccess();
  const id = text(formData.get("reminderId"), 64);
  done(safeBack(formData.get("back")), id ? await completeReminder(id) : { ok: false, error: "notfound" });
}

export async function reopenReminderAction(formData: FormData) {
  await requireAccess();
  const id = text(formData.get("reminderId"), 64);
  done(safeBack(formData.get("back")), id ? await reopenReminder(id) : { ok: false, error: "notfound" });
}

export async function rescheduleReminderAction(formData: FormData) {
  await requireAccess();
  const id = text(formData.get("reminderId"), 64);
  const date = text(formData.get("dueDate"), 10);
  const result = !id ? { ok: false as const, error: "notfound" } : !date || !DATE_RE.test(date) ? { ok: false as const, error: "date" } : await rescheduleReminder(id, date);
  done(safeBack(formData.get("back")), result);
}

export async function cancelReminderAction(formData: FormData) {
  await requireAccess();
  const id = text(formData.get("reminderId"), 64);
  done(safeBack(formData.get("back")), id ? await cancelReminder(id) : { ok: false, error: "notfound" });
}
