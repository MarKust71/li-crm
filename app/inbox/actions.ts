"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { acceptCandidates, rejectCandidates, restoreCandidates } from "@/lib/candidates";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Zaznaczone wpisy z formularza (`ids`); odfiltrowane do poprawnych identyfikatorów, bez powtórek, z limitem. */
function pickedIds(formData: FormData): string[] {
  const out = new Set<string>();
  for (const v of formData.getAll("ids")) if (typeof v === "string" && ID_RE.test(v)) out.add(v);
  return [...out].slice(0, 500);
}

/** Powrót tylko na /inbox (z filtrami); cokolwiek innego → sama poczekalnia, żeby nie dało się przekierować gdziekolwiek. */
function backPath(formData: FormData): string {
  const s = formData.get("back");
  return typeof s === "string" && /^\/inbox(\?[A-Za-z0-9=&%_.+-]{0,200})?$/.test(s) ? s : "/inbox";
}

function back(path: string, params: Record<string, string | number>): never {
  const [base, qs = ""] = path.split("?");
  const p = new URLSearchParams(qs);
  for (const k of ["dodano", "juz", "odrzucono", "przywrocono", "brak"]) p.delete(k);
  for (const [k, v] of Object.entries(params)) p.set(k, String(v));
  revalidatePath("/", "layout"); // licznik w menu
  redirect(`${base}?${p.toString()}`);
}

export async function acceptCandidatesAction(formData: FormData) {
  await requireAccess();
  const ids = pickedIds(formData);
  if (!ids.length) back(backPath(formData), { brak: 1 });
  const r = await acceptCandidates(ids);
  back(backPath(formData), { dodano: r.added, ...(r.alreadyContacts ? { juz: r.alreadyContacts } : {}) });
}

export async function rejectCandidatesAction(formData: FormData) {
  await requireAccess();
  const ids = pickedIds(formData);
  if (!ids.length) back(backPath(formData), { brak: 1 });
  back(backPath(formData), { odrzucono: await rejectCandidates(ids) });
}

export async function restoreCandidatesAction(formData: FormData) {
  await requireAccess();
  const ids = pickedIds(formData);
  if (!ids.length) back(backPath(formData), { brak: 1 });
  back(backPath(formData), { przywrocono: await restoreCandidates(ids) });
}
