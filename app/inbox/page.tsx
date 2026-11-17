import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { SelectAll } from "@/components/select-all";
import { SiteNav } from "@/components/site-nav";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { filtersQuery, parseFilters } from "@/lib/contacts";
import { SOURCE_LABEL } from "@/lib/labels";
import { CANDIDATE_PAGE_SIZE, CANDIDATE_SOURCES, candidateCounts, listCandidates, parseCandidateFilters, type CandidateFilters } from "@/lib/candidates";
import { acceptCandidatesAction, rejectCandidatesAction, restoreCandidatesAction } from "./actions";

export const metadata: Metadata = { title: "Poczekalnia · li-crm" };

const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeZone: "Europe/Warsaw" });

type SP = Promise<Record<string, string | string[] | undefined>>;

function href(f: CandidateFilters, page = 1): string {
  const p = new URLSearchParams();
  if (f.status === "REJECTED") p.set("widok", "odrzucone");
  if (f.q) p.set("q", f.q);
  if (f.otw) p.set("otw", "1");
  if (f.source) p.set("source", f.source);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `/inbox?${qs}` : "/inbox";
}

export default function InboxPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Poczekalnia</h1>
        <SiteNav current="inbox" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję…</p>}>
        <InboxContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function num(v: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && v !== undefined ? n : null;
}

async function InboxContent({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const filters = parseCandidateFilters(sp);
  const [{ rows, total, pages, page }, counts] = await Promise.all([listCandidates(filters), candidateCounts()]);
  const rejectedView = filters.status === "REJECTED";
  const hasFilters = !!(filters.q || filters.otw || filters.source);
  const added = num(sp.dodano);
  const already = num(sp.juz);
  const rejected = num(sp.odrzucono);
  const restored = num(sp.przywrocono);
  const field = "flex flex-col gap-1";

  return (
    <div className="flex flex-col gap-4">
      {added !== null && (
        <Alert>
          <AlertDescription>
            Dodano kontaktów: {added}.{already ? ` Pominięto ${already}: te osoby są już kontaktami.` : ""}{" "}
            {added > 0 && (
              <Link href={`/contacts?${filtersQuery(parseFilters({ added: "today", sort: "added", dir: "desc" }), 1)}`} className="underline">
                Pokaż dodane
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {rejected !== null && <Alert><AlertDescription>Odrzucono osób: {rejected}. Nie wrócą przy kolejnych importach (widok „Odrzucone” pozwala je przywrócić).</AlertDescription></Alert>}
      {restored !== null && <Alert><AlertDescription>Przywrócono do poczekalni: {restored}.</AlertDescription></Alert>}
      {sp.brak && <Alert variant="destructive"><AlertDescription>Nic nie zaznaczono.</AlertDescription></Alert>}

      <p className="text-sm text-muted-foreground">
        Osoby z importów (People you may know, lista oglądających profil) czekają tu na Twoją decyzję: dodaj te, którymi chcesz się zająć (powstanie kontakt „Zebrany”), resztę odrzuć.
        Kontaktów, które już są w bazie, poczekalnia nie dotyczy.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant={rejectedView ? "ghost" : "secondary"}>
          <Link href={href({ ...filters, status: "PENDING" })}>Oczekujące ({counts.pending})</Link>
        </Button>
        <Button asChild size="sm" variant={rejectedView ? "secondary" : "ghost"}>
          <Link href={href({ ...filters, status: "REJECTED" })}>Odrzucone ({counts.rejected})</Link>
        </Button>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        {rejectedView && <input type="hidden" name="widok" value="odrzucone" />}
        <div className={`${field} min-w-40 flex-1`}>
          <Label htmlFor="q" className="text-xs text-muted-foreground">Szukaj w imieniu i zajęciu</Label>
          <Input id="q" type="search" name="q" defaultValue={filters.q} maxLength={100} />
        </div>
        <div className={field}>
          <Label htmlFor="source" className="text-xs text-muted-foreground">Źródło</Label>
          <NativeSelect id="source" name="source" defaultValue={filters.source}>
            <NativeSelectOption value="">Wszystkie</NativeSelectOption>
            {CANDIDATE_SOURCES.map((x) => (
              <NativeSelectOption key={x} value={x}>
                {SOURCE_LABEL[x]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="otw" value="1" defaultChecked={filters.otw} />
          Tylko Open to work
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit">Filtruj</Button>
          {hasFilters && (
            <Button asChild variant="ghost">
              <Link href={href({ ...filters, q: "", otw: false, source: "" })}>Wyczyść</Link>
            </Button>
          )}
        </div>
      </form>

      <p className="text-sm text-muted-foreground">
        {rejectedView ? "Odrzuconych" : "Oczekujących"}: {total}
        {hasFilters ? " (po filtrach)" : ""}. Na stronie najwyżej {CANDIDATE_PAGE_SIZE}; osoby z „Open to work” są na początku.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {rejectedView ? "Brak odrzuconych osób." : "Poczekalnia jest pusta."}
        </p>
      ) : (
        <form className="flex flex-col gap-3">
          <input type="hidden" name="back" value={href(filters, page)} />
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3">
            <SelectAll />
            <div className="flex flex-wrap gap-2">
              {rejectedView ? (
                <SubmitButton formAction={restoreCandidatesAction} pendingLabel="Przywracam…">
                  Przywróć zaznaczone
                </SubmitButton>
              ) : (
                <>
                  <SubmitButton formAction={acceptCandidatesAction} pendingLabel="Dodaję…">
                    Dodaj zaznaczone jako kontakty
                  </SubmitButton>
                  <SubmitButton formAction={rejectCandidatesAction} variant="outline" pendingLabel="Odrzucam…">
                    Odrzuć zaznaczone
                  </SubmitButton>
                </>
              )}
            </div>
          </div>
          <ul className="divide-y rounded-lg border">
            {rows.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                  <input type="checkbox" name="ids" value={c.id} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                        {c.name}
                      </a>
                      {c.openToWork && <Badge variant="secondary">Open to work</Badge>}
                      <Badge variant="outline">{SOURCE_LABEL[c.source]}</Badge>
                      {c._count.views > 0 && <Badge variant="outline">Oglądał profil: {c._count.views}×</Badge>}
                    </span>
                    <span className="block break-words text-muted-foreground">{c.occupation ?? "—"}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    <span className="block">Pierwszy raz: {dateFmt.format(c.firstSeenAt)}</span>
                    <span className="block">Zebrano: {c.seenCount}×</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </form>
      )}

      {pages > 1 && (
        <p className="flex items-center justify-center gap-4 text-sm">
          {page > 1 ? <Link href={href(filters, page - 1)} className="underline">← Poprzednia</Link> : <span className="text-muted-foreground">← Poprzednia</span>}
          <span>Strona {page} z {pages}</span>
          {page < pages ? <Link href={href(filters, page + 1)} className="underline">Następna →</Link> : <span className="text-muted-foreground">Następna →</span>}
        </p>
      )}
    </div>
  );
}
