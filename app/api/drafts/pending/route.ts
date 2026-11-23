import { getPendingBomDrafts } from "@/lib/bom-draft";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function GET(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  return Response.json({ drafts: await getPendingBomDrafts() });
}
