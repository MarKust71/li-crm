import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DeleteEventDialog } from "@/components/delete-event-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { getContact } from "@/lib/contacts";
import { todayWarsaw } from "@/lib/dates";
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
  unarchiveAction,
  updateDetailsAction,
} from "./actions";

export const metadata: Metadata = { title: "Kontakt · li-crm" };

const ERRORS: Record<string, string> = {
  type: "Nieznany typ zdarzenia.",
  date: "Niepoprawna data.",
  reason: "Wybierz powód archiwizacji.",
};

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
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
      <Link href="/contacts" className="mb-3 inline-block text-sm text-muted-foreground underline">
        ← Kontakty
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję kontakt…</p>}>
        <ContactCard params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ContactCard({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const contact = await getContact(id);
  if (!contact) notFound();

  const errorKey = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const error = errorKey ? ERRORS[errorKey] : undefined;
  const today = todayWarsaw();
  const steps = nextSteps(contact.stage, contact.direction);
  const tags = contact.tags.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b, "pl"));

  return (
    <>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="break-words text-2xl font-semibold">{contact.name}</h1>
          {contact.occupation && <p className="mt-1 text-[0.95rem] text-muted-foreground">{contact.occupation}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="font-semibold">
            {STAGE_LABEL[contact.stage]}
          </Badge>
          {contact.openToWork && <Badge>OTW</Badge>}
          {contact.archived && <Badge variant="outline">zarchiwizowany</Badge>}
        </div>
      </header>

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
                <Button type="submit" variant="outline" className="self-start">
                  Zapisz
                </Button>
              </form>
            </details>

            <details className="mt-3.5 text-sm">
              <summary className={summary}>{contact.archived ? "Przywróć kontakt" : "Archiwizuj"}</summary>
              {contact.archived ? (
                <form action={unarchiveAction} className={form}>
                  <input type="hidden" name="id" value={contact.id} />
                  <Button type="submit" variant="outline" className="self-start">
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
                  <Button type="submit" variant="outline" className="self-start">
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
                <Textarea id="next-message" name="message" rows={3} maxLength={5000} />
              </div>
              {steps.includes("BOM_SCHEDULED") && (
                <div className={field}>
                  <Label htmlFor="next-scheduled">Termin spotkania (dla „BOM umówiony”)</Label>
                  <Input id="next-scheduled" type="datetime-local" name="scheduledAt" />
                </div>
              )}
              {steps.length > 0 ? (
                <div className="flex flex-wrap gap-2">
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
                  <Label htmlFor="other-scheduled">Termin spotkania (tylko „BOM umówiony”)</Label>
                  <Input id="other-scheduled" type="datetime-local" name="scheduledAt" />
                </div>
                <Button type="submit" variant="outline" className="self-start">
                  Dodaj
                </Button>
              </form>
            </details>
          </CardContent>
        </Card>
      </div>

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
                  <DeleteEventDialog eventId={e.id} action={deleteEventAction} />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
