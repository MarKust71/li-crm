import { applyResults, type OpResult } from "@/lib/calendar-sync";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function POST(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as { results?: OpResult[] } | null;
  if (!body || !Array.isArray(body.results)) return Response.json({ error: "bad-request" }, { status: 400 });
  const results = body.results.filter((r) => r && (typeof r.refId === "string" || typeof r.reminderId === "string") && typeof r.version === "string");
  return Response.json(await applyResults(results));
}
