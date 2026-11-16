import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { SubmitButton } from "@/components/submit-button";
import { StepMessageField } from "@/components/step-message-field";
import { SiteNav } from "@/components/site-nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { AddReminderForm, ReminderItem } from "@/components/reminders";
import { contactNeighbors, getContact, listContextFrom, type ContactFilters } from "@/lib/contacts";
import { todayWarsaw } from "@/lib/dates";
import { countSameLocation } from "@/lib/contact-events";
import { isSuggestedStep } from "@/lib/invite-message";
import { upcomingMeetings } from "@/lib/meeting-sync-core";
import { listContactReminders } from "@/lib/reminders";
import {
  ALL_EVENT_TYPES,
  ARCHIVE_REASONS,
  ARCHIVE_REASON_LABEL,
  DIRECTION_LABEL,
  EVENT_LABEL,
  SOURCE_LABEL,
  STAGE_LABEL,
  nextSteps,
} from "@/lib/labels";
import {
  addEventAction,
  archiveAction,
  deleteEventAction,
  toggleOpenToWorkAction,
  unarchiveAction,
  updateDetailsAction,
} from "./actions";

// jedno zapytanie o kontakt na żądanie, choć korzystają z niego dwa komponenty (nagłówek i karta)
const getContactCached = cache(getContact);

export const metadata: Metadata = { title: "Kontakt · li-crm" };

const ERRORS: Record<string, string> = {
  type: "Nieznany typ zdarzenia.",
  date: "Niepoprawna data.",
  reason: "Wybierz powód archiwizacji.",
  thread: "Adres wątku musi mieć postać https://www.linkedin.com/messaging/thread/… (skopiuj go z paska adresu rozmowy na LinkedIn). Nic nie zapisano.",
  notfound: "Nie znaleziono przypomnienia (mogło zostać już zmienione lub usunięte).",
  delay: "Podaj liczbę od 1 do 3650 i jednostkę.",
  "no-bom": "Follow-up (FU) można dodać tylko po odbytym BOM.",
  "no-schedule": "Podaj termin (datę i godzinę) spotkania.",
  "has-follow-up": "Nie można usunąć jedynego odbytego BOM, dopóki kontakt ma Follow-up (FU). Usuń najpierw FU.",
};

/** "1 otwarte przypomnienie", "2–4 otwarte przypomnienia", "5+ otwartych przypomnień" (z wyjątkiem 12–14). */
function openRemindersLabel(n: number): string {
  if (n === 1) return "otwarte przypomnienie";
  const last = n % 10;
  return last >= 2 && last <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? "otwarte przypomnienia" : "otwartych przypomnień";
}

const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeZone: "Europe/Warsaw" });
const dateTimeFmt = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Warsaw",
});

// Rozwijane sekcje zostają natywnymi <details> (działają bez JavaScriptu).
const summary = "cursor-pointer text-muted-foreground";
const form = "mt-3 flex flex-col gap-3";
const field = "flex flex-col gap-1.5";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default function ContactPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      {/* Nawigacja i nagłówek kontaktu zostają na wierzchu przy przewijaniu (od szerokości md; na telefonie zajmowałyby za dużo ekranu).
          Paski czasu i synchronizacji są w układzie strony, więc znikają przy przewijaniu i widać je tylko na samej górze. */}
      <div className="z-30 -mx-4 mb-4 border-b bg-background px-4 pb-3 pt-6 md:sticky md:top-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Suspense
            fallback={
              <Link href="/contacts" className="text-sm text-muted-foreground underline">
                ← Kontakty
              </Link>
            }
          >
            <ListNav params={params} searchParams={searchParams} />
          </Suspense>
          <SiteNav current="contacts" />
        </div>
        <Suspense fallback={<div className="h-14" />}>
          <ContactHeader params={params} />
        </Suspense>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję kontakt…</p>}>
        <ContactCard params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Powrót do listy z zachowanymi filtrami i sortowaniem oraz przejście do poprzedniego / następnego kontaktu z tej listy. */
async function ListNav({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const from = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const { filters, query } = listContextFrom(from);
  const back = query ? `/contacts?${query}` : "/contacts";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Link href={back} className="text-sm text-muted-foreground underline">
        ← Kontakty
      </Link>
      {from && (
        <Suspense fallback={null}>
          <Neighbors id={id} filters={filters} query={query} />
        </Suspense>
      )}
    </div>
  );
}

async function Neighbors({ id, filters, query }: { id: string; filters: ContactFilters; query: string }) {
  const n = await contactNeighbors(filters, id);
  if (!n) return null;
  const href = (to: string) => `/contacts/${to}?from=${encodeURIComponent(query)}`;
  const link = "rounded-md border px-2 py-0.5 text-sm hover:bg-muted";
  const off = "rounded-md border px-2 py-0.5 text-sm text-muted-foreground/50";
  return (
    <nav className="flex items-center gap-2" aria-label="Kontakty z listy">
      {n.prev ? (
        <Link href={href(n.prev)} className={link} rel="prev" title="Poprzedni kontakt z listy">
          ← Poprzedni
        </Link>
      ) : (
        <span className={off}>← Poprzedni</span>
      )}
      <span className="text-xs tabular-nums text-muted-foreground" title="Miejsce na liście o bieżących filtrach">
        {n.position.toLocaleString("pl-PL")} z {n.total.toLocaleString("pl-PL")}
      </span>
      {n.next ? (
        <Link href={href(n.next)} className={link} rel="next" title="Następny kontakt z listy">
          Następny →
        </Link>
      ) : (
        <span className={off}>Następny →</span>
      )}
    </nav>
  );
}

/** Nagłówek karty (imię i nazwisko, zajęcie, etap, OTW): przyklejony do góry razem z nawigacją, więc zawsze pod ręką przy przewijaniu. */
async function ContactHeader({ params }: Pick<Props, "params">) {
  const { id } = await params;
  const contact = await getContactCached(id);
  if (!contact) return null;
  return (
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="break-words text-2xl font-semibold">{contact.name}</h1>
          {contact.occupation && <p className="mt-1 text-[0.95rem] text-muted-foreground">{contact.occupation}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-semibold">
            {STAGE_LABEL[contact.stage]}
          </Badge>
          {contact.archived && <Badge variant="outline">zarchiwizowany</Badge>}
          <form action={toggleOpenToWorkAction}>
            <input type="hidden" name="id" value={contact.id} />
            <input type="hidden" name="value" value={contact.openToWork ? "0" : "1"} />
            <SubmitButton
              variant={contact.openToWork ? "default" : "outline"}
              size="xs"
              aria-pressed={contact.openToWork}
              title={contact.openToWork ? "Open to work: włączone (kliknij, aby wyłączyć)" : "Open to work: wyłączone (kliknij, aby włączyć)"}
              className="rounded-full font-semibold"
            >
              OTW
            </SubmitButton>
          </form>
        </div>
      </header>
  );
}

async function ContactCard({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const contact = await getContactCached(id);
  if (!contact) notFound();
  const [reminders, sameLocation] = await Promise.all([listContactReminders(id), countSameLocation(id, contact.location)]);

  const errorKey = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const error = errorKey ? ERRORS[errorKey] : undefined;
  const today = todayWarsaw();
  const openReminders = reminders.filter((r) => r.status === "OPEN").length;
  const meetings = upcomingMeetings(contact.events, new Date());
  const archiveInfo = [contact.archiveReason ? ARCHIVE_REASON_LABEL[contact.archiveReason] : null, contact.archivedAt ? dateFmt.format(contact.archivedAt) : null].filter(Boolean).join(", ");
  const steps = nextSteps(contact.stage, contact.direction);
  const tags = contact.tags.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b, "pl"));

  return (
    <>
      {contact.archived && (
        <Alert className="mb-4">
          <AlertDescription>
            <p>
              <strong>Kontakt zarchiwizowany</strong>
              {archiveInfo ? ` (${archiveInfo})` : ""}. Jest ukryty na liście kontaktów (do przywrócenia w sekcji „Przywróć kontakt”). Zdarzenia i przypomnienia
              możesz nadal dodawać, ale kontakt pozostanie ukryty.
            </p>
            {openReminders > 0 && (
              <p className="mt-1">
                Ma {openReminders} {openRemindersLabel(openReminders)}: nadal widać je w „Dziś”, na Telegramie i w kalendarzu.
              </p>
            )}
            {meetings.length > 0 && (
              <p className="mt-1">
                Umówione spotkanie: {meetings.map((m) => `${m.type === "FOLLOW_UP" ? "FU" : "BOM"} ${dateTimeFmt.format(m.scheduledAt)}`).join(", ")} (zostaje w kalendarzu i dostanie przypomnienie na Telegramie).
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dane</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm [&>dt]:text-muted-foreground [&>dd]:break-words">
              <dt>Profil</dt>
              <dd>
                <a href={contact.profileUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {contact.profileUrl.replace("https://www.", "")} ↗
                </a>
              </dd>
              {contact.location && (
                <>
                  <dt>Lokalizacja</dt>
                  <dd>{contact.location}</dd>
                </>
              )}
              {contact.threadUrl && (
                <>
                  <dt>Wątek</dt>
                  <dd>
                    <a href={contact.threadUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Otwórz rozmowę ↗
                    </a>
                  </dd>
                </>
              )}
              {contact.email && (
                <>
                  <dt>E-mail</dt>
                  <dd>
                    <a href={`mailto:${contact.email}`} className="underline">
                      {contact.email}
                    </a>
                  </dd>
                </>
              )}
              {contact.phone && (
                <>
                  <dt>Telefon</dt>
                  <dd>{contact.phone}</dd>
                </>
              )}
              {contact.salutation && (
                <>
                  <dt>Zwrot</dt>
                  <dd>{contact.salutation}</dd>
                </>
              )}
              <dt>Kierunek</dt>
              <dd>{DIRECTION_LABEL[contact.direction]}</dd>
              <dt>Źródło</dt>
              <dd>
                {SOURCE_LABEL[contact.source]}
                {contact.contactFrom ? ` · ${contact.contactFrom}` : ""}
              </dd>
              {tags.length > 0 && (
                <>
                  <dt>Tagi</dt>
                  <dd className="flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </dd>
                </>
              )}
              {contact.archived && contact.archiveReason && (
                <>
                  <dt>Archiwum</dt>
                  <dd>{ARCHIVE_REASON_LABEL[contact.archiveReason]}</dd>
                </>
              )}
            </dl>
            {contact.info && (
              <>
                <h3 className="mb-1.5 mt-4 text-sm text-muted-foreground">Notatki</h3>
                <p className="whitespace-pre-wrap break-words text-sm">{contact.info}</p>
              </>
            )}

            <details className="mt-3.5 text-sm">
              <summary className={summary}>Edytuj dane</summary>
              <form action={updateDetailsAction} className={form}>
                <input type="hidden" name="id" value={contact.id} />
                <div className={field}>
                  <Label htmlFor="name">Imię i nazwisko</Label>
                  <Input id="name" name="name" defaultValue={contact.name} maxLength={200} required />
                </div>
                <div className={field}>
                  <Label htmlFor="occupation">Zajęcie</Label>
                  <Input id="occupation" name="occupation" defaultValue={contact.occupation ?? ""} maxLength={300} />
                </div>
                <div className={field}>
                  <Label htmlFor="location">Lokalizacja</Label>
                  <Input id="location" name="location" defaultValue={contact.location ?? ""} maxLength={200} />
                  {sameLocation > 0 && (
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" name="applyLocationToAll" className="mt-0.5" />
                      <span>
                        Przy zmianie zmień też u {sameLocation.toLocaleString("pl-PL")} {sameLocation === 1 ? "innego kontaktu" : "innych kontaktów"} z lokalizacją „{contact.location}” (cały
                        zapis, bez rozróżniania wielkości liter)
                      </span>
                    </label>
                  )}
                </div>
                <div className={field}>
                  <Label htmlFor="threadUrl">Wątek LinkedIn (adres rozmowy)</Label>
                  <Input id="threadUrl" name="threadUrl" type="url" defaultValue={contact.threadUrl ?? ""} maxLength={500} />
                </div>
                <div className={field}>
                  <Label htmlFor="salutation">Zwrot (np. „Pani Aniu”)</Label>
                  <Input id="salutation" name="salutation" defaultValue={contact.salutation ?? ""} maxLength={100} />
                </div>
                <div className={field}>
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} maxLength={200} />
                </div>
                <div className={field}>
                  <Label htmlFor="phone">Telefon</Label>
                  <Input id="phone" name="phone" defaultValue={contact.phone ?? ""} maxLength={50} />
                </div>
                <div className={field}>
                  <Label htmlFor="info">Notatki</Label>
                  <Textarea id="info" name="info" rows={5} defaultValue={contact.info ?? ""} maxLength={10000} />
                </div>
                <Button type="submit" variant="outline" className="self-end">
                  Zapisz
                </Button>
              </form>
            </details>

            <details className="mt-3.5 text-sm">
              <summary className={summary}>{contact.archived ? "Przywróć kontakt" : "Archiwizuj"}</summary>
              {contact.archived ? (
                <form action={unarchiveAction} className={form}>
                  <input type="hidden" name="id" value={contact.id} />
                  <Button type="submit" variant="outline" className="self-end">
                    Przywróć z archiwum
                  </Button>
                </form>
              ) : (
                <form action={archiveAction} className={form}>
                  <input type="hidden" name="id" value={contact.id} />
                  <div className={field}>
                    <Label htmlFor="reason">Powód</Label>
                    <NativeSelect id="reason" name="reason" defaultValue="NO_CONVERSATION">
                      {ARCHIVE_REASONS.map((r) => (
                        <NativeSelectOption key={r.value} value={r.value}>
                          {r.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  {openReminders > 0 && (
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" name="cancelReminders" defaultChecked className="mt-0.5" />
                      <span>
                        Anuluj {openReminders} {openRemindersLabel(openReminders)} (znikną też z kalendarza)
                      </span>
                    </label>
                  )}
                  {meetings.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Uwaga: umówione spotkanie ({meetings.map((m) => `${m.type === "FOLLOW_UP" ? "FU" : "BOM"} ${dateTimeFmt.format(m.scheduledAt)}`).join(", ")}) zostaje w kalendarzu. Jeśli się nie odbędzie, odwołaj je w historii kontaktu.
                    </p>
                  )}
                  <Button type="submit" variant="outline" className="self-end">
                    Archiwizuj
                  </Button>
                </form>
              )}
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Następny krok</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addEventAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={contact.id} />
              <div className={field}>
                <Label htmlFor="next-date">Data</Label>
                <Input id="next-date" type="date" name="date" defaultValue={today} required />
              </div>
              <div className={field}>
                <Label htmlFor="next-message">Treść wiadomości (opcjonalnie)</Label>
                {isSuggestedStep(steps[0]) ? (
                  <StepMessageField key={steps[0]} step={steps[0]} salutation={contact.salutation} />
                ) : (
                  <Textarea id="next-message" name="message" rows={3} maxLength={5000} />
                )}
              </div>
              {(steps.includes("BOM_SCHEDULED") || steps.includes("FOLLOW_UP")) && (
                <div className={field}>
                  <Label htmlFor="next-scheduled">Termin spotkania (wymagany dla „BOM umówiony” i „Follow-up”)</Label>
                  <Input id="next-scheduled" type="datetime-local" name="scheduledAt" />
                </div>
              )}
              {steps.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {steps.map((t, i) => (
                    <Button key={t} type="submit" name="type" value={t} variant={i === 0 ? "default" : "outline"}>
                      {EVENT_LABEL[t]}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Dla tego etapu nie ma proponowanego kroku. Użyj „Inne zdarzenie”.
                </p>
              )}
            </form>

            <details className="mt-3.5 text-sm">
              <summary className={summary}>Inne zdarzenie</summary>
              <form action={addEventAction} className={form}>
                <input type="hidden" name="id" value={contact.id} />
                <div className={field}>
                  <Label htmlFor="other-type">Typ</Label>
                  <NativeSelect id="other-type" name="type" defaultValue="NOTE">
                    {ALL_EVENT_TYPES.map((t) => (
                      <NativeSelectOption key={t} value={t}>
                        {EVENT_LABEL[t]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className={field}>
                  <Label htmlFor="other-date">Data</Label>
                  <Input id="other-date" type="date" name="date" defaultValue={today} required />
                </div>
                <div className={field}>
                  <Label htmlFor="other-message">Treść / notatka</Label>
                  <Textarea id="other-message" name="message" rows={3} maxLength={5000} />
                </div>
                <div className={field}>
                  <Label htmlFor="other-scheduled">Termin spotkania (wymagany dla „BOM umówiony” i „Follow-up”)</Label>
                  <Input id="other-scheduled" type="datetime-local" name="scheduledAt" />
                </div>
                <Button type="submit" variant="outline" className="self-end">
                  Dodaj
                </Button>
              </form>
            </details>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Przypomnienia ({reminders.filter((r) => r.status === "OPEN").length} otwartych)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {reminders.length > 0 && (
            <ul className="flex flex-col gap-2">
              {reminders.map((r) => (
                <ReminderItem key={r.id} r={r} today={today} back={`/contacts/${contact.id}`} showContact={false} />
              ))}
            </ul>
          )}
          <AddReminderForm contactId={contact.id} back={`/contacts/${contact.id}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historia ({contact.events.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {contact.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak zdarzeń.</p>
          ) : (
            <ol className="border-l-2 pl-4">
              {contact.events.map((e) => (
                <li
                  key={e.id}
                  className="relative pb-4 before:absolute before:-left-[22px] before:top-1.5 before:size-2.5 before:rounded-full before:bg-foreground before:content-['']"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[0.85rem] text-muted-foreground">
                      {dateFmt.format(e.occurredAt)}
                      {e.dateUnknown && <em className="not-italic text-warn"> · data nieznana</em>}
                    </span>
                    <strong>{EVENT_LABEL[e.type]}</strong>
                  </div>
                  {e.scheduledAt && (
                    <p className="text-sm text-muted-foreground">Termin: {dateTimeFmt.format(e.scheduledAt)}</p>
                  )}
                  {e.message && (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted px-2.5 py-2 text-sm">
                      {e.message}
                    </p>
                  )}
                  <ConfirmDeleteDialog
                    fieldName="eventId"
                    id={e.id}
                    action={deleteEventAction}
                    title="Usunąć zdarzenie?"
                    description="Tej operacji nie można cofnąć. Etap kontaktu zostanie przeliczony bez tego zdarzenia."
                  />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
