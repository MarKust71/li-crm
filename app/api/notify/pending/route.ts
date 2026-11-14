import { purgeExpired } from "@/lib/activity-log";
import { getDueMessages } from "@/lib/notify";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function GET(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  // okazja do sprzątania dziennika (najwyżej raz na dobę); błąd nie może zablokować powiadomień
  await purgeExpired().catch((e) => console.error("activity log purge:", e instanceof Error ? e.message : e));
  return Response.json({ messages: await getDueMessages() });
}
