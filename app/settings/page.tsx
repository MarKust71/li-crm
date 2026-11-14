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
import { MAX_IDLE_MINUTES, MAX_INTERVAL_MINUTES, MAX_LEAD_MINUTES, getNotifySettings, getTimeSettings } from "@/lib/settings";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { notifyTestAction, saveIntervalAction, saveNotifyAction, saveTimeSettingsAction, syncNowAction } from "./actions";

export const metadata: Metadata = { title: "Ustawienia · li-crm" };

const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Warsaw" });

export default function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; requested?: string; error?: string; notifySaved?: string; notifyTest?: string; timeSaved?: string }> }) {
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

async function SettingsContent({ searchParams }: { searchParams: Promise<{ saved?: string; requested?: string; error?: string; notifySaved?: string; notifyTest?: string; timeSaved?: string }> }) {
  await connection();
  const sp = await searchParams;
  const { settings: s, counts } = await syncStatus();
  const n = await getNotifySettings();
  const t = await getTimeSettings();
  const mode = s.intervalMinutes < 0 ? "off" : s.intervalMinutes === 0 ? "manual" : "interval";
  const waiting = s.manualRequestedAt && (!s.lastRunAt || s.manualRequestedAt > s.lastRunAt);
  const errors = counts.ERROR ?? 0;
  return (
    <>
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
        {sp.error === "interval" && <Alert variant="destructive"><AlertDescription>Niepoprawna liczba minut (1–{MAX_INTERVAL_MINUTES}).</AlertDescription></Alert>}
        {sp.error === "notify" && <Alert variant="destructive"><AlertDescription>Niepoprawne ustawienia powiadomień (minuty przed spotkaniem: 0–{MAX_LEAD_MINUTES}).</AlertDescription></Alert>}
        {sp.notifySaved && <Alert><AlertDescription>Zapisano ustawienia powiadomień.</AlertDescription></Alert>}
        {sp.notifyTest && <Alert><AlertDescription>Zgłoszono wiadomość testową. Przyjdzie na Telegram przy najbliższym sprawdzeniu (do minuty).</AlertDescription></Alert>}

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
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Powiadomienia Telegram</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Wiadomości wysyła n8n (workflow „li-crm: powiadomienia Telegram”, sprawdza co minutę). Godziny w czasie warszawskim.
          </p>
          <form action={saveNotifyAction} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="digestHour">Poranny przegląd dnia (przypomnienia i spotkania)</Label>
              <NativeSelect id="digestHour" name="digestHour" defaultValue={n.digestHour < 0 ? "off" : String(n.digestHour)}>
                <NativeSelectOption value="off">Wyłączony</NativeSelectOption>
                {Array.from({ length: 24 }, (_, h) => (
                  <NativeSelectOption key={h} value={String(h)}>{`od ${String(h).padStart(2, "0")}:00`}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead">Przypomnienie o spotkaniu (BOM, FU) na tyle minut przed (0 = wyłączone)</Label>
              <Input id="lead" name="lead" type="number" min={0} max={MAX_LEAD_MINUTES} defaultValue={n.meetingLeadMinutes} className="w-28" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="errorAlerts" defaultChecked={n.errorAlerts} /> Powiadamiaj o błędach synchronizacji z kalendarzem
            </label>
            <div><Button type="submit">Zapisz</Button></div>
          </form>
          <form action={notifyTestAction}>
            <Button type="submit" variant="secondary">Wyślij wiadomość testową</Button>
          </form>
        </CardContent>
      </Card>
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Czas pracy: podpowiedzi</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Aplikacja zna tylko swoje zmiany (dziennik), więc tylko ich używa do podpowiedzi. Zatrzymanie sesji zawsze zatwierdzasz sam.
        </p>
        {sp.timeSaved && <Alert><AlertDescription>Zapisano ustawienia czasu pracy.</AlertDescription></Alert>}
        {sp.error === "time" && <Alert variant="destructive"><AlertDescription>Niepoprawny próg: 0 (wyłączone) albo 15–{MAX_IDLE_MINUTES} minut.</AlertDescription></Alert>}
        <form action={saveTimeSettingsAction} className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idleMinutes">Zaproponuj zakończenie sesji po tylu minutach bez zmian w aplikacji (0 = wyłączone)</Label>
            <Input id="idleMinutes" name="idleMinutes" type="number" min={0} max={MAX_IDLE_MINUTES} defaultValue={t.idleMinutes} className="w-28" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="suggestStart" defaultChecked={t.suggestStart} /> Podpowiadaj włączenie rejestrowania, gdy pracuję w aplikacji bez włączonego czasu
          </label>
          <div><Button type="submit">Zapisz</Button></div>
        </form>
      </CardContent>
    </Card>
    </>
  );
}
