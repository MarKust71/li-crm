import { logActivity } from "@/lib/activity-log";
import { recordSent } from "@/lib/notify";
import { hasSyncKey, unauthorized } from "@/lib/sync-auth";

export async function POST(request: Request) {
  if (!hasSyncKey(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as { results?: { key?: unknown; ok?: unknown }[] } | null;
  if (!body || !Array.isArray(body.results)) return Response.json({ error: "bad-request" }, { status: 400 });
  // tylko potwierdzone wysyłki; klucze ograniczone długością
  const keys = body.results.filter((r) => r && r.ok === true && typeof r.key === "string" && r.key.length > 0 && r.key.length <= 200).map((r) => r.key as string);
  await recordSent(keys);
  const KIND: Record<string, string> = {
    digest: "poranny przegląd", meeting: "przypomnienie o spotkaniu", error: "alert o błędzie", test: "wiadomość testowa",
    report: "raport dzienny", reporttest: "testowy raport dzienny",
  };
  const isEmail = (key: string) => key.startsWith("report");
  const kind = (key: string) => KIND[key.split(":")[0]] ?? "wiadomość";
  for (const key of keys) {
    await logActivity({ source: "NOTIFY", action: "notify.sent", summary: `Wysłano ${isEmail(key) ? "e-mailem" : "na Telegram"}: ${kind(key)}`, details: { key } });
  }
  const failedKeys = body.results.filter((r) => r && r.ok !== true && typeof r.key === "string").map((r) => String(r.key).slice(0, 200));
  for (const key of failedKeys) {
    await logActivity({ source: "NOTIFY", level: "ERROR", action: "notify.failed", summary: `Nie udało się wysłać ${isEmail(key) ? "e-maila" : "wiadomości na Telegram"} (${kind(key)})`, details: { key } });
  }
  return Response.json({ recorded: keys.length, failed: body.results.length - keys.length });
}
