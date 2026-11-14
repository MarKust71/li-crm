import { timingSafeEqual } from "node:crypto";

/** Klucz API synchronizacji (nagłówek x-api-key). Bez ustawionego SYNC_API_KEY endpointy są zamknięte. */
export function hasSyncKey(request: Request): boolean {
  const expected = process.env.SYNC_API_KEY;
  if (!expected || expected.length < 24) return false;
  const given = request.headers.get("x-api-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const unauthorized = () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
