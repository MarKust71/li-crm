import { ingestProfile } from "@/lib/ingest";
import { parseProfilePayload } from "@/lib/ingest-core";
import { hasIngestKey, unauthorized } from "@/lib/sync-auth";

export const maxDuration = 30;

/** POST z n8n: dane jednego profilu ze strony /in/ (content6.js; patrz lib/ingest.ts). Odpowiedź zawiera `report` i gotowy tekst `message` dla Telegrama. */
export async function POST(request: Request) {
  if (!hasIngestKey(request)) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "json" }, { status: 400 });
  }
  const parsed = parseProfilePayload(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { report, message } = await ingestProfile(parsed.item);
  return Response.json({ report, message });
}
