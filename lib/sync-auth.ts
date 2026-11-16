import { timingSafeEqual } from "node:crypto";

function keyMatches(request: Request, expected: string | undefined): boolean {
  if (!expected || expected.length < 24) return false;
  const given = request.headers.get("x-api-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Klucz API przyjmowania danych z rozszerzenia (INGEST_API_KEY, osobny od SYNC_API_KEY). Bez ustawionego klucza endpoint jest zamknięty. */
export const hasIngestKey = (request: Request) => keyMatches(request, process.env.INGEST_API_KEY);

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
