import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Elapsed } from "@/components/elapsed";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toDateTimeInput } from "@/lib/dates";
import { formatDuration } from "@/lib/format";
import {
  getRunningEntry,
  isLongRunning,
  listActivityTypes,
  listEntries,
  periodTotals,
  totalsByActivity,
  totalsByDay,
  totalsByMonth,
  type ActivityRow,
  type PeriodRow,
} from "@/lib/time";
import { deleteEntryAction, startAction, stopAction, updateEntryAction } from "./actions";

export const metadata: Metadata = { title: "Czas pracy · li-crm" };

const ERRORS: Record<string, string> = {
  running: "Sesja już trwa. Zakończ ją, zanim rozpoczniesz nową.",
  notfound: "Nie znaleziono wpisu (mógł zostać już zmieniony lub usunięty).",
  date: "Niepoprawna data lub godzina.",
  end_before_start: "Koniec nie może być wcześniejszy niż początek.",
  count: "Liczba sztuk musi być liczbą całkowitą od 0 do 100000.",
};

const TZ = "Europe/Warsaw";
const dateTimeFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("pl-PL", { timeStyle: "short", timeZone: TZ });
const dayLabelFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthLabelFmt = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" });

const field = "flex flex-col gap-1.5";
const summary = "cursor-pointer text-muted-foreground";

const dayLabel = (period: string) => dayLabelFmt.format(new Date(`${period}T12:00:00Z`));
const monthLabel = (period: string) => monthLabelFmt.format(new Date(`${period}-15T12:00:00Z`));

/** 212.4 s → "3,5 min"; poniżej minuty w sekundach. */
function perPiece(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  return `${(seconds / 60).toFixed(1).replace(".", ",")} min`;
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function TimePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Czas pracy</h1>
        <SiteNav current="time" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję…</p>}>
        <TimeContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function TimeContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const errorKey = one(sp.error);
  const error = errorKey ? ERRORS[errorKey] : undefined;
  const requestedPage = Number.parseInt(one(sp.page), 10);

  const [running, activities, totals, byDay, byMonth, byActivity, list] = await Promise.all([
    getRunningEntry(),
    listActivityTypes(),
    periodTotals(),
    totalsByDay(14),
    totalsByMonth(12),
    totalsByActivity(),
    listEntries(Number.isFinite(requestedPage) ? requestedPage : 1),
  ]);

  return (
    <>
      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {running ? (
        <RunningCard running={running} activities={activities} page={list.page} />
      ) : (
        <StartCard activities={activities} />
      )}

      <div className="my-4 grid gap-4 sm:grid-cols-3">
        <TotalCard label="Dziś" seconds={totals.today} />
        <TotalCard label="Ten tydzień" seconds={totals.week} />
        <TotalCard label="Ten miesiąc" seconds={totals.month} />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Wpisy ({list.total.toLocaleString("pl-PL")})</CardTitle>
        </CardHeader>
        <CardContent>
          {list.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak zakończonych wpisów.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.entries.map((e) => {
                const end = e.endedAt!;
                const seconds = (end.getTime() - e.startedAt.getTime()) / 1000;
                const startInitial = toDateTimeInput(e.startedAt);
                const endInitial = toDateTimeInput(end);
                return (
                  <li key={e.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-sm text-muted-foreground">
                        {dateFmt.format(e.startedAt)}, {timeFmt.format(e.startedAt)}–{timeFmt.format(end)}
                      </span>
                      {seconds < 0 ? (
                        <Badge variant="outline" className="text-warn">
                          błędny czas
                        </Badge>
                      ) : (
                        <span className="text-sm">{formatDuration(seconds)}</span>
                      )}
                      <strong>
                        {e.activityType?.name ?? "(bez czynności)"}
                        {e.count !== null && ` (${e.count})`}
                      </strong>
                    </div>
                    {e.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{e.note}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3">
                      <details className="text-sm">
                        <summary className={summary}>Edytuj</summary>
                        <form action={updateEntryAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="page" value={list.page} />
                          <input type="hidden" name="startedAtInitial" value={startInitial} />
                          <input type="hidden" name="endedAtInitial" value={endInitial} />
                          <div className={field}>
                            <Label htmlFor={`s-${e.id}`}>Początek</Label>
                            <Input id={`s-${e.id}`} type="datetime-local" name="startedAt" defaultValue={startInitial} required />
                          </div>
                          <div className={field}>
                            <Label htmlFor={`e-${e.id}`}>Koniec</Label>
                            <Input id={`e-${e.id}`} type="datetime-local" name="endedAt" defaultValue={endInitial} required />
                          </div>
                          <ActivityFields activities={activities} selectedId={e.activityType?.id ?? ""} idPrefix={e.id} />
                          <div className={field}>
                            <Label htmlFor={`c-${e.id}`}>Liczba sztuk</Label>
                            <Input id={`c-${e.id}`} name="count" inputMode="numeric" defaultValue={e.count ?? ""} />
                          </div>
                          <div className={`${field} sm:col-span-2`}>
                            <Label htmlFor={`n-${e.id}`}>Notatka</Label>
                            <Textarea id={`n-${e.id}`} name="note" rows={2} defaultValue={e.note ?? ""} maxLength={2000} />
                          </div>
                          <Button type="submit" variant="outline" className="self-start sm:col-span-2">
                            Zapisz
                          </Button>
                        </form>
                      </details>
                      <ConfirmDeleteDialog
                        fieldName="entryId"
                        id={e.id}
                        action={deleteEntryAction}
                        title="Usunąć wpis czasu?"
                        description="Tej operacji nie można cofnąć. Wpis zniknie z listy i ze wszystkich podsumowań."
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {list.pages > 1 && (
            <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Strony">
              {list.page > 1 ? (
                <Link href={list.page - 1 === 1 ? "/time" : `/time?page=${list.page - 1}`} className="underline">
                  ← Nowsze
                </Link>
              ) : (
                <span />
              )}
              <span>
                Strona {list.page} z {list.pages}
              </span>
              {list.page < list.pages ? (
                <Link href={`/time?page=${list.page + 1}`} className="underline">
                  Starsze →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <PeriodCard title="Ostatnie dni" rows={byDay} label={dayLabel} />
        <PeriodCard title="Miesiące" rows={byMonth} label={monthLabel} />
        <ActivityCard rows={byActivity} />
      </div>
    </>
  );
}

type Activities = Awaited<ReturnType<typeof listActivityTypes>>;

function ActivityFields({ activities, selectedId, idPrefix }: { activities: Activities; selectedId: string; idPrefix: string }) {
  return (
    <>
      <div className={field}>
        <Label htmlFor={`a-${idPrefix}`}>Czynność</Label>
        <NativeSelect id={`a-${idPrefix}`} name="activityId" defaultValue={selectedId}>
          <NativeSelectOption value="">(bez czynności)</NativeSelectOption>
          {activities.map((a) => (
            <NativeSelectOption key={a.id} value={a.id}>
              {a.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className={field}>
        <Label htmlFor={`na-${idPrefix}`}>lub nowa czynność</Label>
        <Input id={`na-${idPrefix}`} name="newActivity" maxLength={100} placeholder="nazwa (ma pierwszeństwo przed listą)" />
      </div>
    </>
  );
}

function StartCard({ activities }: { activities: Activities }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rozpocznij sesję</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={startAction} className="grid gap-3 sm:grid-cols-2">
          <ActivityFields activities={activities} selectedId="" idPrefix="start" />
          <Button type="submit" className="self-start sm:col-span-2">
            Start
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Czynność, liczbę sztuk i godziny możesz ustawić przy zakończeniu.</p>
      </CardContent>
    </Card>
  );
}

function RunningCard({
  running,
  activities,
  page,
}: {
  running: NonNullable<Awaited<ReturnType<typeof getRunningEntry>>>;
  activities: Activities;
  page: number;
}) {
  const startInitial = toDateTimeInput(running.startedAt);
  const longRunning = isLongRunning(running.startedAt);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3">
          Trwa sesja
          {longRunning && (
            <Badge variant="outline" className="text-warn">
              trwa ponad 12 h: sprawdź godziny
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Elapsed startedAt={running.startedAt.getTime()} className="font-mono text-4xl tabular-nums" />
          <span className="text-sm text-muted-foreground">od {dateTimeFmt.format(running.startedAt)}</span>
        </div>
        <form action={stopAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={running.id} />
          <input type="hidden" name="page" value={page} />
          <input type="hidden" name="startedAtInitial" value={startInitial} />
          <div className={field}>
            <Label htmlFor="run-start">Początek</Label>
            <Input id="run-start" type="datetime-local" name="startedAt" defaultValue={startInitial} />
          </div>
          <div className={field}>
            <Label htmlFor="run-end">Koniec (puste = teraz)</Label>
            <Input id="run-end" type="datetime-local" name="endedAt" />
          </div>
          <ActivityFields activities={activities} selectedId={running.activityType?.id ?? ""} idPrefix="run" />
          <div className={field}>
            <Label htmlFor="run-count">Liczba sztuk</Label>
            <Input id="run-count" name="count" inputMode="numeric" defaultValue={running.count ?? ""} />
          </div>
          <div className={`${field} sm:col-span-2`}>
            <Label htmlFor="run-note">Notatka</Label>
            <Textarea id="run-note" name="note" rows={2} defaultValue={running.note ?? ""} maxLength={2000} />
          </div>
          <Button type="submit" className="self-start sm:col-span-2">
            Zakończ sesję
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TotalCard({ label, seconds }: { label: string; seconds: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{seconds > 0 ? formatDuration(seconds) : "0 min"}</p>
      </CardContent>
    </Card>
  );
}

function PeriodCard({ title, rows, label }: { title: string; rows: PeriodRow[]; label: (p: string) => string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.period} className="border-b last:border-0">
                <td className="py-1.5 capitalize">{label(r.period)}</td>
                <td className="py-1.5 text-right text-muted-foreground">{r.entries} wpis.</td>
                <td className="py-1.5 text-right font-medium tabular-nums">{formatDuration(r.seconds)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="py-1.5 text-muted-foreground">Brak danych.</td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ rows }: { rows: ActivityRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Czynności: czas na sztukę</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 font-normal">Czynność</th>
              <th className="pb-1 text-right font-normal">Czas</th>
              <th className="pb-1 text-right font-normal">Szt.</th>
              <th className="pb-1 text-right font-normal">/ szt.</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.name} className="border-b last:border-0">
                <td className="max-w-32 truncate py-1.5" title={r.name}>
                  {r.name}
                </td>
                <td className="py-1.5 text-right tabular-nums">{formatDuration(r.seconds)}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{r.pieces || "—"}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{perPiece(r.secondsPerPiece)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 12 && <p className="mt-2 text-xs text-muted-foreground">…i {rows.length - 12} rzadszych czynności.</p>}
        <p className="mt-2 text-xs text-muted-foreground">Czas na sztukę liczony tylko z wpisów z liczbą sztuk.</p>
      </CardContent>
    </Card>
  );
}
