import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReminderItem } from "@/components/reminders";
import { SiteNav } from "@/components/site-nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayWarsaw } from "@/lib/dates";
import { UPCOMING_DAYS, listToday } from "@/lib/reminders";

export const metadata: Metadata = { title: "Dziś do zrobienia · li-crm" };

const ERRORS: Record<string, string> = {
  notfound: "Nie znaleziono przypomnienia (mogło zostać już zmienione lub usunięte).",
  date: "Niepoprawna data.",
  delay: "Podaj liczbę od 1 do 3650 i jednostkę.",
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function TodayPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-12 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Dziś do zrobienia</h1>
        <SiteNav current="today" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję…</p>}>
        <TodayContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function TodayContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const error = ERRORS[one(sp.error)];
  const requested = Number.parseInt(one(sp.page), 10);
  const t = await listToday(Number.isFinite(requested) ? requested : 1);
  const today = todayWarsaw(); // po pobraniu danych: czas w prerenderze jest dozwolony dopiero po dostępie zależnym od żądania
  const back = t.overduePage > 1 ? `/today?page=${t.overduePage}` : "/today";

  return (
    <>
      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="mb-4 text-sm text-muted-foreground">
        Dziś: {t.today.length} · zaległe: {t.overdueTotal.toLocaleString("pl-PL")} · najbliższe {UPCOMING_DAYS} dni: {t.upcoming.length}
      </p>

      <Section title={`Dziś (${t.today.length})`} empty="Nic zaplanowanego na dziś.">
        {t.today.map((r) => (
          <ReminderItem key={r.id} r={r} today={today} back={back} />
        ))}
      </Section>

      <Section title={`Zaległe (${t.overdueTotal.toLocaleString("pl-PL")})`} empty="Brak zaległych przypomnień.">
        {t.overdue.map((r) => (
          <ReminderItem key={r.id} r={r} today={today} back={back} />
        ))}
        {t.overduePages > 1 && (
          <li className="list-none">
            <nav className="mt-2 flex items-center justify-between gap-3 text-sm" aria-label="Strony zaległych">
              {t.overduePage > 1 ? (
                <Link href={t.overduePage - 1 === 1 ? "/today" : `/today?page=${t.overduePage - 1}`} className="underline">
                  ← Poprzednie
                </Link>
              ) : (
                <span />
              )}
              <span>
                Strona {t.overduePage} z {t.overduePages}
              </span>
              {t.overduePage < t.overduePages ? (
                <Link href={`/today?page=${t.overduePage + 1}`} className="underline">
                  Następne →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </li>
        )}
      </Section>

      <Section title={`Najbliższe ${UPCOMING_DAYS} dni (${t.upcoming.length})`} empty="Nic w najbliższym tygodniu.">
        {t.upcoming.map((r) => (
          <ReminderItem key={r.id} r={r} today={today} back={back} />
        ))}
      </Section>
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  const hasItems = children.flat().filter(Boolean).length > 0;
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{hasItems ? <ul className="flex flex-col gap-2">{children}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent>
    </Card>
  );
}
