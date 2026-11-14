"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";

export async function deletePasskeyAction(formData: FormData) {
  await requireAccess();
  const id = formData.get("passkeyId");
  if (typeof id === "string" && id.length > 0 && id.length <= 64) {
    const key = await prisma.passkey.findUnique({ where: { id }, select: { name: true } });
    const res = await prisma.passkey.deleteMany({ where: { id } });
    if (res.count === 1) await logActivity({ source: "AUTH", action: "auth.passkey_deleted", summary: `Usunięto klucz dostępu: ${key?.name ?? ""}` });
  }
  revalidatePath("/security");
  redirect("/security");
}
