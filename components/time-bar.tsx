import { cookies } from "next/headers";
import { snoozeTimeBarAction, startFromBarAction, stopFromBarAction } from "@/app/time/actions";
import { Elapsed } from "@/components/elapsed";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { hasAccess } from "@/lib/access";
import { warsawDateOf } from "@/lib/dates";
import { getTimeBar } from "@/lib/time-assist";
import { listActivityTypes } from "@/lib/time";

const clock = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });

/** "17:42" albo "wczoraj 17:42" / "12.11 17:42", gdy inny dzień niż dziś. */
function when(d: Date, now: Date): string {
  const day = warsawDateOf(d);
  if (day === warsawDateOf(now)) return clock.format(d);
  return `${day.slice(8, 10)}.${day.slice(5, 7)} ${clock.format(d)}`;
}

const cookieNum = (v: string | undefined) => (v && /^\d{10,15}$/.test(v) ? Number(v) : null);

/** Pasek u góry strony: podpowiada włączenie rejestrowania czasu albo zakończenie zapomnianej sesji. Bez okien: tylko gdy jest o czym przypomnieć. */
export async function TimeBar() {
  if (!(await hasAccess())) return null;
  const jar = await cookies();
  const now = new Date();
  const { bar, running } = await getTimeBar(now, { idle: cookieNum(jar.get("li_snooze_idle")?.value), start: cookieNum(jar.get("li_snooze_start")?.value) });
  if (!bar) return null;

  const wrap = "flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/60 px-4 py-2 text-sm";

  if (bar.kind === "idle" && running) {
    const noActivity = bar.lastActivityAt.getTime() - bar.startedAt.getTime() < 60_000;
    return (
      <div role="status" className={wrap}>
        <span>
          Sesja czasu pracy trwa <Elapsed startedAt={running.startedAt.getTime()} className="font-mono tabular-nums" />
          {running.activityType ? ` (${running.activityType.name})` : ""}, a ostatnia aktywność w aplikacji była {noActivity ? "przy starcie sesji" : `o ${when(bar.lastActivityAt, now)}`}. Zakończyć?
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {!noActivity && (
            <form action={stopFromBarAction}>
              <input type="hidden" name="id" value={running.id} />
              <input type="hidden" name="endedAt" value={bar.lastActivityAt.toISOString()} />
              <SubmitButton size="sm">Zakończ o {when(bar.lastActivityAt, now)}</SubmitButton>
            </form>
          )}
          <form action={stopFromBarAction}>
            <input type="hidden" name="id" value={running.id} />
            <SubmitButton size="sm" variant="outline">Zakończ teraz</SubmitButton>
          </form>
          <Snooze kind="idle" keepLabel="Pracuję dalej" />
        </div>
      </div>
    );
  }

  if (bar.kind === "start") {
    const activities = await listActivityTypes();
    return (
      <div role="status" className={wrap}>
        <span>Nie rejestrujesz czasu pracy, a w aplikacji coś się dzieje (od {when(bar.from, now)}).</span>
        <form action={startFromBarAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="from" value={bar.from.toISOString()} />
          <NativeSelect name="activityId" defaultValue={activities[0]?.id ?? ""} aria-label="Czynność" size="sm">
            <NativeSelectOption value="">(bez czynności)</NativeSelectOption>
            {activities.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {a.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input name="newActivity" maxLength={100} placeholder="lub nowa czynność" aria-label="Nowa czynność" className="h-7 w-40 text-sm" />
          <SubmitButton size="sm" name="mode" value="from">
            Włącz od {when(bar.from, now)}
          </SubmitButton>
          <SubmitButton size="sm" variant="outline" name="mode" value="now">
            Włącz od teraz
          </SubmitButton>
        </form>
        <Snooze kind="start" keepLabel="Nie teraz" />
      </div>
    );
  }
  return null;
}

function Snooze({ kind, keepLabel }: { kind: "idle" | "start"; keepLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <form action={snoozeTimeBarAction}>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="mode" value="2h" />
        <SubmitButton size="sm" variant="ghost" className="text-muted-foreground" title="Ukryj pasek na 2 godziny">
          {keepLabel}
        </SubmitButton>
      </form>
      <form action={snoozeTimeBarAction}>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="mode" value="day" />
        <SubmitButton size="sm" variant="ghost" className="text-muted-foreground" title="Ukryj pasek do końca dnia">
          Nie dziś
        </SubmitButton>
      </form>
    </div>
  );
}
