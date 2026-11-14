import { applyCalendarChanges, recordError } from "@/lib/calendar-sync";
import type { CalendarEventLite } from "@/lib/calendar-sync-core";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function POST(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as { events?: CalendarEventLite[]; cursor?: string; error?: string } | null;
  if (!body) return Response.json({ error: "bad-request" }, { status: 400 });
  if (body.error) {
    await recordError(body.error);
    return Response.json({ ok: false });
  }
  if (!Array.isArray(body.events)) return Response.json({ error: "bad-request" }, { status: 400 });
  const cursor = body.cursor && !Number.isNaN(Date.parse(body.cursor)) ? new Date(body.cursor) : null;
  return Response.json(await applyCalendarChanges(body.events, cursor));
}
