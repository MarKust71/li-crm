import { claimRun } from "@/lib/calendar-sync";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function GET(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  return Response.json(await claimRun());
}
