import { ingestPymk } from "@/lib/ingest";
import { parsePymkPayload } from "@/lib/ingest-core";
import { hasIngestKey, unauthorized } from "@/lib/sync-auth";

export const maxDuration = 60;

/** POST z n8n: osoby z popupu „People you may know” (content4.js; patrz lib/ingest.ts). Odpowiedź zawiera `report` i gotowy tekst `message` dla Telegrama. */
export async function POST(request: Request) {
  if (!hasIngestKey(request)) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "json" }, { status: 400 });
  }
  const parsed = parsePymkPayload(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { report, message } = await ingestPymk(parsed.items, parsed.invalid);
  return Response.json({ report, message });
}
