import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { getStats, type Stats } from "@/lib/stats";
import {
  SERIES_STEPS, STEPS, STEP_LABEL, TAG_STEPS, bucketLabel, fmtDays, fmtPct, pct,
} from "@/lib/stats-core";

export const metadata: Metadata = { title: "Statystyki · li-crm" };

type SP = Promise<{ [key: string]: string | string[] | undefined }>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function StatsPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Statystyki</h1>
        <SiteNav current="stats" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Liczę…</p>}>
        <StatsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const th = "px-2 py-1.5 text-left font-medium text-muted-foreground";
const td = "px-2 py-1.5 tabular-nums";
const num = "px-2 py-1.5 text-right tabular-nums";

function Bar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-24 rounded bg-muted" aria-hidden>
      <div className="h-2 rounded bg-primary" style={{ width: `${w}%` }} />
    </div>
  );
}

async function StatsContent({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const s = await getStats({
    period: one(sp.period), from: one(sp.from), to: one(sp.to), direction: one(sp.direction), tag: one(sp.tag), gran: one(sp.gran),
  });
  const p = s.period;
  return (
    <div className="flex flex-col gap-4">
      <Filters s={s} />
      <p className="text-sm text-muted-foreground">
        Okres: <strong>{p.label}</strong> ({p.from ?? "początek danych"} do {p.to}, bez ostatniego). Zdarzenia z nieznaną datą ({s.unknownDateEvents}) nie są
        liczone w czasie. Liczby to osoby, nie wiadomości.
      </p>
      <Funnel s={s} />
      <Series s={s} />
      <Timings s={s} />
      <ByTag s={s} />
    </div>
  );
}

function Filters({ s }: { s: Stats }) {
  const p = s.period;
  return (
    <Card>
      <CardContent className="pt-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="period">Okres</Label>
            <NativeSelect id="period" name="period" defaultValue={p.preset}>
              <NativeSelectOption value="7">Ostatnie 7 dni</NativeSelectOption>
              <NativeSelectOption value="30">Ostatnie 30 dni</NativeSelectOption>
              <NativeSelectOption value="90">Ostatnie 90 dni</NativeSelectOption>
              <NativeSelectOption value="365">Ostatnie 12 miesięcy</NativeSelectOption>
              <NativeSelectOption value="all">Cały okres</NativeSelectOption>
              <NativeSelectOption value="custom">Własny zakres (daty obok)</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from">Od</Label>
            <Input id="from" name="from" type="date" defaultValue={p.preset === "custom" ? (p.from ?? "") : ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to">Do (włącznie)</Label>
            <Input id="to" name="to" type="date" defaultValue="" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="direction">Kierunek</Label>
            <NativeSelect id="direction" name="direction" defaultValue={s.direction}>
              <NativeSelectOption value="">Wszystkie</NativeSelectOption>
              <NativeSelectOption value="OUTBOUND">Ja zapraszam</NativeSelectOption>
              <NativeSelectOption value="INBOUND">Zaprosili mnie</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag">Segment (tag)</Label>
            <NativeSelect id="tag" name="tag" defaultValue={s.tag}>
              <NativeSelectOption value="">Wszystkie</NativeSelectOption>
              {s.tags.map((t) => (
                <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gran">Szereg</Label>
            <NativeSelect id="gran" name="gran" defaultValue={s.gran}>
              <NativeSelectOption value="day">Dni</NativeSelectOption>
              <NativeSelectOption value="week">Tygodnie</NativeSelectOption>
              <NativeSelectOption value="month">Miesiące</NativeSelectOption>
            </NativeSelect>
          </div>
          <Button type="submit">Pokaż</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Funnel({ s }: { s: Stats }) {
  const byKey = new Map(s.steps.map((x) => [x.key, x]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lejek</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          <strong>Kohorta:</strong> {s.cohortSize} osób zaproszonych w okresie i ile z nich dotarło do kroku (kiedykolwiek, także po okresie).
          „Do poprzedniego” liczy względem kroku nadrzędnego w lejku; może przekraczać 100%, gdy ktoś pominął krok (np. BOM umówiony bez
          zaproponowania). „Zdarzenia w okresie” to osoby, u których dany krok wydarzył się w okresie.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className={th}>Krok</th>
                <th className={`${th} text-right`}>Zdarzenia w okresie</th>
                <th className={`${th} text-right`}>Kohorta</th>
                <th className={`${th} text-right`}>% zaproszonych</th>
                <th className={`${th} text-right`}>% poprzedniego</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {STEPS.map((st) => {
                const x = byKey.get(st.key)!;
                const parent = st.parent ? byKey.get(st.parent)! : null;
                return (
                  <tr key={st.key} className="border-b last:border-0">
                    <td className={td}>{st.label}</td>
                    <td className={num}>{x.periodContacts}</td>
                    <td className={num}>{x.cohort}</td>
                    <td className={num}>{st.key === "invite" ? "—" : fmtPct(pct(x.cohort, s.cohortSize))}</td>
                    <td className={num}>{parent ? fmtPct(pct(x.cohort, parent.cohort)) : "—"}</td>
                    <td className={td}><Bar value={x.cohort} max={s.cohortSize} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Series({ s }: { s: Stats }) {
  const max = Math.max(0, ...s.series.map((r) => r.counts.invite ?? 0));
  const totals = Object.fromEntries(SERIES_STEPS.map((k) => [k, s.series.reduce((a, r) => a + (r.counts[k] ?? 0), 0)]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>W czasie ({s.gran === "day" ? "dni" : s.gran === "week" ? "tygodnie" : "miesiące"})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b">
                <th className={th}>Przedział</th>
                {SERIES_STEPS.map((k) => (
                  <th key={k} className={`${th} text-right`}>{STEP_LABEL[k]}</th>
                ))}
                <th className={th} />
              </tr>
              <tr className="border-b font-medium">
                <td className={td}>Suma przedziałów</td>
                {SERIES_STEPS.map((k) => (
                  <td key={k} className={num}>{totals[k]}</td>
                ))}
                <td />
              </tr>
            </thead>
            <tbody>
              {s.series.map((r) => (
                <tr key={r.bucket} className="border-b last:border-0">
                  <td className={td}>{bucketLabel(r.bucket, s.gran)}</td>
                  {SERIES_STEPS.map((k) => (
                    <td key={k} className={`${num} ${r.counts[k] ? "" : "text-muted-foreground"}`}>{r.counts[k] ?? 0}</td>
                  ))}
                  <td className={td}><Bar value={r.counts.invite ?? 0} max={max} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Timings({ s }: { s: Stats }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Czas reakcji</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Dni od pierwszego zdarzenia „od” do pierwszego „do” u tej samej osoby, dla osób, których krok „od” wypadł w okresie. Bez zdarzeń z nieznaną datą.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className={th}>Od → do</th>
                <th className={`${th} text-right`}>Osób</th>
                <th className={`${th} text-right`}>Mediana</th>
                <th className={`${th} text-right`}>Średnia</th>
              </tr>
            </thead>
            <tbody>
              {s.timings.map((t) => (
                <tr key={`${t.from}-${t.to}`} className="border-b last:border-0">
                  <td className={td}>{STEP_LABEL[t.from]} → {STEP_LABEL[t.to]}</td>
                  <td className={num}>{t.n}</td>
                  <td className={num}>{fmtDays(t.medianDays)}</td>
                  <td className={num}>{fmtDays(t.avgDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ByTag({ s }: { s: Stats }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Segmenty (tagi)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Kohorta zaproszonych w okresie, podzielona na tagi (osoba z kilkoma tagami liczy się w każdym). Filtr segmentu tu nie działa.
        </p>
        {s.byTag.length === 0 ? (
          <p className="text-sm">Brak zaproszonych w tym okresie.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={th}>Segment</th>
                  <th className={`${th} text-right`}>Zaproszonych</th>
                  {TAG_STEPS.map((k) => (
                    <th key={k} className={`${th} text-right`}>{STEP_LABEL[k]}</th>
                  ))}
                  <th className={`${th} text-right`}>% przyjęcia</th>
                </tr>
              </thead>
              <tbody>
                {s.byTag.map((r) => (
                  <tr key={r.tag} className="border-b last:border-0">
                    <td className={td}>{r.tag}</td>
                    <td className={num}>{r.cohort}</td>
                    {TAG_STEPS.map((k) => (
                      <td key={k} className={num}>{r.counts[k] ?? 0}</td>
                    ))}
                    <td className={num}>{fmtPct(pct(r.counts.accepted ?? 0, r.cohort))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
