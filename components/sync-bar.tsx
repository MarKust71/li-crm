import Link from "next/link";
import { syncNowFromBarAction } from "@/app/settings/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/submit-button";
import { hasAccess } from "@/lib/access";
import { syncQueue } from "@/lib/calendar-sync";
import { syncBarState } from "@/lib/calendar-sync-core";
import { getSyncSettings } from "@/lib/settings";

const plural = (n: number) => (n === 1 ? "zmiana czeka" : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? "zmiany czekają" : "zmian czeka");

/**
 * Pasek u góry strony: są zmiany, które jeszcze nie trafiły do Kalendarza Google. Przycisk zgłasza synchronizację (n8n podejmie ją przy
 * najbliższym sprawdzeniu, do minuty); w trakcie przebiegu przycisku nie ma (zob. syncBarState); pasek odświeża się sam i znika,
 * gdy kolejka jest pusta. Przy wyłączonej synchronizacji (-1) nic nie pokazuje.
 */
export async function SyncBar() {
  if (!(await hasAccess())) return null;
  const [s, q] = await Promise.all([getSyncSettings(), syncQueue()]);
  if (s.intervalMinutes < 0) return null;
  const wrap = "flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b bg-muted/60 px-4 py-2 text-center text-sm";
  const state = syncBarState({ manualRequestedAt: s.manualRequestedAt, lastRunAt: s.lastRunAt, lastFinishedAt: s.lastFinishedAt, now: new Date() });

  const stuck =
    q.stuck > 0 ? (
      <span className="text-destructive">
        {q.stuck} {q.stuck === 1 ? "zmiana" : "zmian"} nie dotarło do kalendarza mimo ponowień.{" "}
        <Link href="/settings" className="underline">
          Szczegóły w Ustawieniach
        </Link>
      </span>
    ) : null;

  if (q.pending === 0) return stuck ? <div role="status" className={wrap}>{stuck}</div> : null;

  return (
    <div role="status" className={wrap}>
      <AutoRefresh everyMs={state === "idle" ? 15000 : 5000} />
      {state === "requested" ? (
        <span>
          Zgłoszono synchronizację z Kalendarzem Google, ruszy w ciągu minuty ({q.pending} {plural(q.pending)}).
        </span>
      ) : state === "running" ? (
        <span>
          Trwa synchronizacja z Kalendarzem Google ({q.pending} {plural(q.pending)}). Zmiany dodane w trakcie trafią do następnej.
        </span>
      ) : (
        <>
          <span>
            {q.pending} {plural(q.pending)} na synchronizację z Kalendarzem Google
            {s.intervalMinutes > 0 ? ` (automat co ${s.intervalMinutes} min)` : ""}.
          </span>
          <form action={syncNowFromBarAction}>
            <SubmitButton size="sm" pendingLabel="Zgłaszam…">
              Synchronizuj kalendarz
            </SubmitButton>
          </form>
        </>
      )}
      {stuck}
    </div>
  );
}
