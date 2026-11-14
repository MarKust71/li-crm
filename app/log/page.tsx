import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { PurgeLog } from "@/components/purge-log";
import { SiteNav } from "@/components/site-nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LEVELS, RETENTION_DAYS, SOURCES, activityStats, listActivity, parseLogFilters, type LogFilters } from "@/lib/activity-log";
import { purgeLogAction } from "./actions";

export const metadata: Metadata = { title: "Dziennik · li-crm" };

const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Warsaw" });
const SOURCE_LABEL = { UI: "Użytkownik", SYNC: "Synchronizacja", NOTIFY: "Powiadomienia", AUTH: "Logowanie", SYSTEM: "System" } as const;
const LEVEL_LABEL = { INFO: "Info", WARN: "Ostrzeżenie", ERROR: "Błąd" } as const;

type SP = Promise<Record<string, string | string[] | undefined>>;

function href(f: LogFilters, page: number): string {
  const p = new URLSearchParams();
  if (f.source) p.set("source", f.source);
  if (f.level) p.set("level", f.level);
  if (f.contact) p.set("contact", f.contact);
  if (f.q) p.set("q", f.q);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `/log?${qs}` : "/log";
}

export default function LogPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Dziennik</h1>
        <SiteNav current="log" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję…</p>}>
        <LogContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LogContent({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const filters = parseLogFilters(sp);
  const [{ rows, total, pages, page, names }, stats] = await Promise.all([listActivity(filters), activityStats()]);
  const hasFilters = !!(filters.source || filters.level || filters.contact || filters.q || filters.from || filters.to);
  const purged = typeof sp.purged === "string" ? sp.purged : null;
  const field = "flex flex-col gap-1";

  return (
    <div className="flex flex-col gap-4">
      {purged !== null && <Alert><AlertDescription>Usunięto wpisów: {purged}.</AlertDescription></Alert>}
      {sp.error && <Alert variant="destructive"><AlertDescription>Niepoprawne dane czyszczenia dziennika.</AlertDescription></Alert>}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className={field}>
          <Label htmlFor="source" className="text-xs text-muted-foreground">Źródło</Label>
          <NativeSelect id="source" name="source" defaultValue={filters.source}>
            <NativeSelectOption value="">Wszystkie</NativeSelectOption>
            {SOURCES.map((s) => <NativeSelectOption key={s} value={s}>{SOURCE_LABEL[s]}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className={field}>
          <Label htmlFor="level" className="text-xs text-muted-foreground">Poziom</Label>
          <NativeSelect id="level" name="level" defaultValue={filters.level}>
            <NativeSelectOption value="">Wszystkie</NativeSelectOption>
            {LEVELS.map((l) => <NativeSelectOption key={l} value={l}>{LEVEL_LABEL[l]}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className={field}>
          <Label htmlFor="from" className="text-xs text-muted-foreground">Od</Label>
          <Input id="from" type="date" name="from" defaultValue={filters.from} className="w-40" />
        </div>
        <div className={field}>
          <Label htmlFor="to" className="text-xs text-muted-foreground">Do</Label>
          <Input id="to" type="date" name="to" defaultValue={filters.to} className="w-40" />
        </div>
        <div className={`${field} min-w-40 flex-1`}>
          <Label htmlFor="q" className="text-xs text-muted-foreground">Szukaj w opisie</Label>
          <Input id="q" type="search" name="q" defaultValue={filters.q} maxLength={100} />
        </div>
        {filters.contact && <input type="hidden" name="contact" value={filters.contact} />}
        <div className="flex items-center gap-2">
          <Button type="submit">Filtruj</Button>
          {hasFilters && (
            <Button asChild variant="ghost">
              <Link href="/log">Wyczyść</Link>
            </Button>
          )}
        </div>
      </form>

      {filters.contact && (
        <p className="text-sm text-muted-foreground">
          Tylko wpisy kontaktu: {names.get(filters.contact) ?? filters.contact}. <Link href={href({ ...filters, contact: "" }, 1)} className="underline">Pokaż wszystkie</Link>
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Wpisów: {total}
        {hasFilters ? " (po filtrach)" : ""}. Najstarszy w dzienniku: {stats.oldest ? dateFmt.format(stats.oldest) : "brak"}.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Brak wpisów.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-start sm:gap-3">
              <time dateTime={r.at.toISOString()} className="shrink-0 tabular-nums text-xs text-muted-foreground sm:w-40 sm:pt-0.5">
                {dateFmt.format(r.at)}
              </time>
              <div className="flex shrink-0 gap-1.5 sm:w-32">
                <Badge variant="outline">{SOURCE_LABEL[r.source]}</Badge>
                {r.level !== "INFO" && <Badge variant={r.level === "ERROR" ? "destructive" : "secondary"}>{LEVEL_LABEL[r.level]}</Badge>}
              </div>
              <div className="min-w-0 flex-1 break-words">
                {r.summary}
                {r.contactId && names.has(r.contactId) && (
                  <>
                    {" "}
                    <Link href={`/contacts/${r.contactId}`} className="text-xs underline">kontakt</Link>{" "}
                    <Link href={href({ ...filters, contact: r.contactId }, 1)} className="text-xs text-muted-foreground underline">tylko ten kontakt</Link>
                  </>
                )}
                <div className="font-mono text-[0.7rem] text-muted-foreground">{r.action}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <p className="flex items-center justify-center gap-4 text-sm">
          {page > 1 ? <Link href={href(filters, page - 1)} className="underline">← Nowsze</Link> : <span className="text-muted-foreground">← Nowsze</span>}
          <span>Strona {page} z {pages}</span>
          {page < pages ? <Link href={href(filters, page + 1)} className="underline">Starsze →</Link> : <span className="text-muted-foreground">Starsze →</span>}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Czyszczenie dziennika</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Wpisy starsze niż {RETENTION_DAYS} dni są usuwane automatycznie (raz na dobę). Możesz też wyczyścić dziennik ręcznie.
          </p>
          <PurgeLog action={purgeLogAction} />
        </CardContent>
      </Card>
    </div>
  );
}
