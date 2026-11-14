import { recordSent } from "@/lib/notify";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function POST(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as { results?: { key?: unknown; ok?: unknown }[] } | null;
  if (!body || !Array.isArray(body.results)) return Response.json({ error: "bad-request" }, { status: 400 });
  // tylko potwierdzone wysyłki; klucze ograniczone długością
  const keys = body.results.filter((r) => r && r.ok === true && typeof r.key === "string" && r.key.length > 0 && r.key.length <= 200).map((r) => r.key as string);
  await recordSent(keys);
  return Response.json({ recorded: keys.length, failed: body.results.length - keys.length });
}
