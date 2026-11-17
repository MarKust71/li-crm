import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboard } from "@/lib/stats";
import { DASH_WINDOWS, fmtPct, pct, type DashMode } from "@/lib/stats-core";

export const metadata: Metadata = { title: "Dashboard · li-crm" };

type SP = Promise<{ [key: string]: string | string[] | undefined }>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function DashboardPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <SiteNav current="dashboard" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Liczę…</p>}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const href = (okres: string, kohorta: boolean) => `/dashboard?okres=${okres}&kohorta=${kohorta ? "1" : "0"}`;

function Toggle({ options, current }: { options: { label: string; to: string; active: boolean }[]; current: string }) {
  return (
    <div className="flex gap-1" role="group" aria-label={current}>
      {options.map((o) => (
        <Button key={o.label} asChild size="sm" variant={o.active ? "secondary" : "ghost"}>
          <Link href={o.to} aria-current={o.active ? "true" : undefined}>{o.label}</Link>
        </Button>
      ))}
    </div>
  );
}

async function DashboardContent({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const mode: DashMode = one(sp.okres) === "calendar" ? "calendar" : "rolling";
  const cohort = one(sp.kohorta) !== "0";
  const d = await getDashboard(mode, cohort);

  const rows = [
    { title: "Zaproszenia", value: (w: (typeof d.windows)[keyof typeof d.windows]) => ({ n: w.cell.invites, share: null as number | null }), note: "" },
    { title: "Przyjęte zaproszenia", value: (w: (typeof d.windows)[keyof typeof d.windows]) => ({ n: w.cell.accepted, share: pct(w.cell.accepted, w.cell.invites) }), note: "zaproszeń" },
    { title: "Zapytania o rozmowę", value: (w: (typeof d.windows)[keyof typeof d.windows]) => ({ n: w.cell.asked, share: pct(w.cell.asked, w.cell.accepted) }), note: "przyjętych" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Toggle
          current="Sposób liczenia okresów"
          options={[
            { label: "Wstecz od dziś", to: href("rolling", cohort), active: mode === "rolling" },
            { label: "Bieżący tydzień/miesiąc/rok", to: href("calendar", cohort), active: mode === "calendar" },
          ]}
        />
        <Toggle
          current="Kohorta"
          options={[
            { label: "Ścisła kohorta", to: href(mode, true), active: cohort },
            { label: "Wszystkie zdarzenia z okresu", to: href(mode, false), active: !cohort },
          ]}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Tylko wysłane zaproszenia, liczymy osoby. Tydzień zaczyna się w poniedziałek (dziś: {d.today}).{" "}
        {cohort
          ? "Ścisła kohorta: przyjęcie liczy się tylko, gdy zaproszenie było w tym samym okresie; pytanie o rozmowę, gdy w tym okresie było też przyjęcie."
          : "Każdy krok liczony osobno w okresie, więc procenty mogą przekraczać 100%."}
      </p>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <section key={r.title} aria-label={r.title}>
            <h2 className="mb-1 text-sm font-medium text-muted-foreground">{r.title}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {DASH_WINDOWS.map((w) => {
                const win = d.windows[w];
                const v = r.value(win);
                return (
                  <Card key={w}>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-sm font-normal text-muted-foreground">{win.period.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-semibold tabular-nums">{v.n}</div>
                      <div className="h-5 text-sm tabular-nums text-muted-foreground">
                        {r.note ? `${fmtPct(v.share)} ${r.note}` : ""}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
