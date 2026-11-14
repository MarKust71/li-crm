"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { logActivity, purgeActivity } from "@/lib/activity-log";
import { parseDateInput } from "@/lib/dates";

export async function purgeLogAction(formData: FormData) {
  await requireAccess();
  const scope = formData.get("scope");
  let removed: number;
  if (scope === "all") {
    removed = await purgeActivity(null);
  } else if (scope === "before") {
    const raw = formData.get("before");
    const before = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseDateInput(raw) : null;
    if (!before) redirect("/log?error=date");
    removed = await purgeActivity(before);
  } else {
    redirect("/log?error=scope");
  }
  // sam wpis o czyszczeniu zostaje, żeby było widać, że i kiedy log wyczyszczono
  await logActivity({
    source: "UI",
    action: "log.purged",
    summary: scope === "all" ? `Wyczyszczono cały dziennik (${removed} wpisów)` : `Usunięto wpisy sprzed ${String(formData.get("before"))} (${removed})`,
    details: { removed, scope: String(scope) },
  });
  revalidatePath("/log");
  redirect(`/log?purged=${removed}`);
}
