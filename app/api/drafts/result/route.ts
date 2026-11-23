import { logActivity } from "@/lib/activity-log";
import { recordSent } from "@/lib/notify";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function POST(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as { results?: { key?: unknown; ok?: unknown }[] } | null;
  if (!body || !Array.isArray(body.results)) return Response.json({ error: "bad-request" }, { status: 400 });
  const valid = (r: { key?: unknown }) => typeof r?.key === "string" && r.key.startsWith("bomdraft:") && r.key.length <= 200;
  const ok = body.results.filter((r) => r && r.ok === true && valid(r)).map((r) => r.key as string);
  await recordSent(ok);
  for (const key of ok) await logActivity({ source: "SYNC", action: "bomdraft.created", summary: "Utworzono szkic e-maila po umówieniu BOM", details: { key } });
  const failed = body.results.filter((r) => r && r.ok !== true && valid(r));
  for (const r of failed) await logActivity({ source: "SYNC", level: "ERROR", action: "bomdraft.failed", summary: "Nie udało się utworzyć szkicu e-maila po umówieniu BOM", details: { key: String(r.key) } });
  return Response.json({ recorded: ok.length, failed: failed.length });
}
