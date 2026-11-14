"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { requestManualSync, setIntervalMinutes } from "@/lib/settings";

export async function saveIntervalAction(formData: FormData) {
  await requireAccess();
  const mode = formData.get("mode");
  let minutes: number;
  if (mode === "off") minutes = -1;
  else if (mode === "manual") minutes = 0;
  else minutes = Number(formData.get("minutes"));
  const ok = await setIntervalMinutes(minutes);
  revalidatePath("/settings");
  redirect(ok ? "/settings?saved=1" : "/settings?error=interval");
}

export async function syncNowAction() {
  await requireAccess();
  await requestManualSync();
  revalidatePath("/settings");
  redirect("/settings?requested=1");
}
