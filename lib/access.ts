import { headers } from "next/headers";
import { checkBasicAuth } from "./basic-auth";

/** Druga linia obrony: każda Server Action sprawdza dostęp sama (Server Actions są wywoływalne przez POST). */
export async function requireAccess(): Promise<void> {
  const h = await headers();
  if (checkBasicAuth(h.get("authorization")) !== "ok") throw new Error("Brak dostępu");
}
