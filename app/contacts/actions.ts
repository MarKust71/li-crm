"use server";

import type { ArchiveReason } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { bulkSetArchived } from "@/lib/contact-events";
import { ARCHIVE_REASONS } from "@/lib/labels";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Zaznaczone kontakty z formularza (`ids`): tylko poprawne identyfikatory, bez powtórek, z limitem. */
function pickedIds(formData: FormData): string[] {
  const out = new Set<string>();
  for (const v of formData.getAll("ids")) if (typeof v === "string" && ID_RE.test(v)) out.add(v);
  return [...out].slice(0, 500);
}

/** Powrót tylko na /contacts (z filtrami); cokolwiek innego → sama lista, żeby nie dało się przekierować gdziekolwiek. */
function backPath(formData: FormData): string {
  const s = formData.get("back");
  return typeof s === "string" && /^\/contacts(\?[A-Za-z0-9=&%_.+*~-]{0,1000})?$/.test(s) ? s : "/contacts";
}

function back(path: string, params: Record<string, string | number>): never {
  const [base, qs = ""] = path.split("?");
  const p = new URLSearchParams(qs);
  for (const k of ["zarchiwizowano", "przywrocono", "pominieto", "brak", "powod"]) p.delete(k);
  for (const [k, v] of Object.entries(params)) p.set(k, String(v));
  revalidatePath("/contacts");
  redirect(`${base}?${p.toString()}`);
}

export async function bulkArchiveAction(formData: FormData) {
  await requireAccess();
  const path = backPath(formData);
  const ids = pickedIds(formData);
  if (!ids.length) back(path, { brak: 1 });
  const reason = formData.get("reason") as ArchiveReason | null;
  if (!reason || !ARCHIVE_REASONS.some((r) => r.value === reason)) back(path, { powod: 1 });
  const r = await bulkSetArchived(ids, reason, { cancelReminders: formData.get("cancelReminders") === "on" });
  back(path, { zarchiwizowano: r.changed, ...(r.skipped ? { pominieto: r.skipped } : {}) });
}

export async function bulkUnarchiveAction(formData: FormData) {
  await requireAccess();
  const path = backPath(formData);
  const ids = pickedIds(formData);
  if (!ids.length) back(path, { brak: 1 });
  const r = await bulkSetArchived(ids, null);
  back(path, { przywrocono: r.changed, ...(r.skipped ? { pominieto: r.skipped } : {}) });
}
