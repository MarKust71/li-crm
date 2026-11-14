import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { SiteNav } from "@/components/site-nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { syncStatus } from "@/lib/calendar-sync";
import { MAX_INTERVAL_MINUTES } from "@/lib/settings";
import { saveIntervalAction, syncNowAction } from "./actions";

export const metadata: Metadata = { title: "Ustawienia · li-crm" };

const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Warsaw" });

export default function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; requested?: string; error?: string }> }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Ustawienia</h1>
        <SiteNav current="settings" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję…</p>}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SettingsContent({ searchParams }: { searchParams: Promise<{ saved?: string; requested?: string; error?: string }> }) {
  await connection();
  const sp = await searchParams;
  const { settings: s, counts } = await syncStatus();
  const mode = s.intervalMinutes < 0 ? "off" : s.intervalMinutes === 0 ? "manual" : "interval";
  const waiting = s.manualRequestedAt && (!s.lastRunAt || s.manualRequestedAt > s.lastRunAt);
  const errors = counts.ERROR ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Synchronizacja z Kalendarzem Google</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Przypomnienia są dwustronnie synchronizowane z kalendarzem „dMb” przez n8n. Workflow co minutę pyta aplikację, czy ma teraz
          synchronizować; decyduje poniższe ustawienie.
        </p>
        {sp.saved && <Alert><AlertDescription>Zapisano ustawienie.</AlertDescription></Alert>}
        {sp.requested && <Alert><AlertDescription>Zgłoszono synchronizację. Ruszy przy najbliższym sprawdzeniu (do minuty).</AlertDescription></Alert>}
        {sp.error && <Alert variant="destructive"><AlertDescription>Niepoprawna liczba minut (1–{MAX_INTERVAL_MINUTES}).</AlertDescription></Alert>}

        <form action={saveIntervalAction} className="flex flex-col gap-3 rounded-lg border p-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Tryb</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="off" defaultChecked={mode === "off"} /> Wyłączona</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="manual" defaultChecked={mode === "manual"} /> Tylko ręcznie (przycisk poniżej)</label>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input type="radio" name="mode" value="interval" defaultChecked={mode === "interval"} /> Automatycznie co
              <Label htmlFor="minutes" className="sr-only">Liczba minut</Label>
              <Input id="minutes" name="minutes" type="number" min={1} max={MAX_INTERVAL_MINUTES} defaultValue={s.intervalMinutes > 0 ? s.intervalMinutes : 5} className="w-24" /> min
            </label>
          </fieldset>
          <div><Button type="submit">Zapisz</Button></div>
        </form>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <form action={syncNowAction}>
            <Button type="submit" variant="secondary" disabled={mode === "off"}>Synchronizuj teraz</Button>
          </form>
          {waiting && <Badge variant="secondary">oczekuje na uruchomienie</Badge>}
          {mode === "off" && <span className="text-sm text-muted-foreground">Synchronizacja jest wyłączona.</span>}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Ostatnie uruchomienie</dt>
          <dd>{s.lastRunAt ? dateFmt.format(s.lastRunAt) : "jeszcze nie było"}</dd>
          <dt className="text-muted-foreground">Zmiany z kalendarza odczytane do</dt>
          <dd>{s.pullCursor ? dateFmt.format(s.pullCursor) : "-"}</dd>
          <dt className="text-muted-foreground">Oczekujące na wysłanie</dt>
          <dd>{counts.PENDING ?? 0}</dd>
          <dt className="text-muted-foreground">Z błędem</dt>
          <dd>{errors > 0 ? <Badge variant="destructive">{errors}</Badge> : 0}</dd>
          {s.lastError && (<><dt className="text-muted-foreground">Ostatni błąd</dt><dd>{s.lastError}</dd></>)}
        </dl>
      </CardContent>
    </Card>
  );
}
