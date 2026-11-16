import { ingestViewers } from "@/lib/ingest";
import { parseViewersPayload } from "@/lib/ingest-core";
import { hasIngestKey, unauthorized } from "@/lib/sync-auth";

export const maxDuration = 60;

/** POST z n8n: lista osób z „Kto oglądał Twój profil” (patrz lib/ingest.ts). Odpowiedź zawiera `report` i gotowy tekst `message` dla Telegrama. */
export async function POST(request: Request) {
  if (!hasIngestKey(request)) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "json" }, { status: 400 });
  }
  const parsed = parseViewersPayload(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { report, message } = await ingestViewers(parsed.items, parsed.invalid, parsed.scrapedAt);
  return Response.json({ report, message });
}
