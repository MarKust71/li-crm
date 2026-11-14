import { getDueMessages } from "@/lib/notify";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function GET(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  return Response.json({ messages: await getDueMessages() });
}
