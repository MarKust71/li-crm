import { cookies } from "next/headers";
import { authMode, getAuthConfig } from "./auth/config";
import { SESSION_COOKIE, verifySessionToken } from "./auth/session";

/** Czy bieżące żądanie ma ważną sesję (w trybie "open" poza produkcją: zawsze tak). */
export async function hasAccess(): Promise<boolean> {
  const mode = authMode();
  if (mode === "open") return true;
  const config = getAuthConfig();
  if (mode !== "enforce" || !config) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token, config.secret) : false;
}

/** Druga linia obrony: każda Server Action sprawdza sesję sama (Server Actions są wywoływalne przez POST, z pominięciem UI). */
export async function requireAccess(): Promise<void> {
  if (!(await hasAccess())) throw new Error("Brak dostępu");
}
