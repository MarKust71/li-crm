"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";

export async function deletePasskeyAction(formData: FormData) {
  await requireAccess();
  const id = formData.get("passkeyId");
  if (typeof id === "string" && id.length > 0 && id.length <= 64) await prisma.passkey.deleteMany({ where: { id } });
  revalidatePath("/security");
  redirect("/security");
}
