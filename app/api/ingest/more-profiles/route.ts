import { ingestPymk } from "@/lib/ingest";
import { parsePymkPayload } from "@/lib/ingest-core";
import { hasIngestKey, unauthorized } from "@/lib/sync-auth";

export const maxDuration = 60;

/** POST z n8n: osoby z popupu „More profiles” (content7.js; ten sam przebieg co PYMK, lib/ingest.ts, wpisy poczekalni ze źródłem MORE_PROFILES). Odpowiedź zawiera `report` i gotowy tekst `message` dla Telegrama. */
export async function POST(request: Request) {
  if (!hasIngestKey(request)) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "json" }, { status: 400 });
  }
  const parsed = parsePymkPayload(body, "more_profiles");
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { report, message } = await ingestPymk(parsed.items, parsed.invalid, "MORE_PROFILES");
  return Response.json({ report, message });
}
