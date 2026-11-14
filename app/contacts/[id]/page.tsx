import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DeleteEventDialog } from "@/components/delete-event-dialog";
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

// Wspólne style (do czasu przejścia na komponenty shadcn).
const panel = "rounded-lg border border-border p-4";
const h2 = "mb-3 text-base font-semibold";
const pill = "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs";
const form = "mt-2.5 flex flex-col gap-2.5";
const label = "flex flex-col gap-1 text-xs text-muted-foreground";
const field = "rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground";
const btn = "cursor-pointer self-start rounded-md border border-border bg-background px-3.5 py-2 text-sm text-foreground";
const btnPrimary =
  "cursor-pointer self-start rounded-md border border-foreground bg-foreground px-3.5 py-2 text-sm text-background";
const summary = "cursor-pointer text-muted-foreground";

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
          <span className={`${pill} border border-foreground font-semibold`}>{STAGE_LABEL[contact.stage]}</span>
          {contact.openToWork && <span className={`${pill} bg-foreground text-background`}>OTW</span>}
          {contact.archived && <span className={`${pill} border border-border bg-muted`}>zarchiwizowany</span>}
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <section className={panel}>
          <h2 className={h2}>Dane</h2>
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
                    <span key={t} className={`${pill} border border-border bg-muted`}>
                      {t}
                    </span>
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
              <label className={label}>
                <span>Zwrot (np. „Pani Aniu”)</span>
                <input name="salutation" defaultValue={contact.salutation ?? ""} maxLength={100} className={field} />
              </label>
              <label className={label}>
                <span>E-mail</span>
                <input name="email" type="email" defaultValue={contact.email ?? ""} maxLength={200} className={field} />
              </label>
              <label className={label}>
                <span>Telefon</span>
                <input name="phone" defaultValue={contact.phone ?? ""} maxLength={50} className={field} />
              </label>
              <label className={label}>
                <span>Notatki</span>
                <textarea name="info" rows={5} defaultValue={contact.info ?? ""} maxLength={10000} className={field} />
              </label>
              <button type="submit" className={btn}>
                Zapisz
              </button>
            </form>
          </details>

          <details className="mt-3.5 text-sm">
            <summary className={summary}>{contact.archived ? "Przywróć kontakt" : "Archiwizuj"}</summary>
            {contact.archived ? (
              <form action={unarchiveAction} className={form}>
                <input type="hidden" name="id" value={contact.id} />
                <button type="submit" className={btn}>
                  Przywróć z archiwum
                </button>
              </form>
            ) : (
              <form action={archiveAction} className={form}>
                <input type="hidden" name="id" value={contact.id} />
                <label className={label}>
                  <span>Powód</span>
                  <select name="reason" defaultValue="NO_CONVERSATION" className={field}>
                    {ARCHIVE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className={btn}>
                  Archiwizuj
                </button>
              </form>
            )}
          </details>
        </section>

        <section className={panel}>
          <h2 className={h2}>Następny krok</h2>
          <form action={addEventAction} className="flex flex-col gap-2.5">
            <input type="hidden" name="id" value={contact.id} />
            <label className={label}>
              <span>Data</span>
              <input type="date" name="date" defaultValue={today} required className={field} />
            </label>
            <label className={label}>
              <span>Treść wiadomości (opcjonalnie)</span>
              <textarea name="message" rows={3} maxLength={5000} className={field} />
            </label>
            {steps.includes("BOM_SCHEDULED") && (
              <label className={label}>
                <span>Termin spotkania (dla „BOM umówiony”)</span>
                <input type="datetime-local" name="scheduledAt" className={field} />
              </label>
            )}
            {steps.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {steps.map((t, i) => (
                  <button key={t} type="submit" name="type" value={t} className={i === 0 ? btnPrimary : btn}>
                    {EVENT_LABEL[t]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Dla tego etapu nie ma proponowanego kroku. Użyj „Inne zdarzenie”.</p>
            )}
          </form>

          <details className="mt-3.5 text-sm">
            <summary className={summary}>Inne zdarzenie</summary>
            <form action={addEventAction} className={form}>
              <input type="hidden" name="id" value={contact.id} />
              <label className={label}>
                <span>Typ</span>
                <select name="type" defaultValue="NOTE" className={field}>
                  {ALL_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EVENT_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                <span>Data</span>
                <input type="date" name="date" defaultValue={today} required className={field} />
              </label>
              <label className={label}>
                <span>Treść / notatka</span>
                <textarea name="message" rows={3} maxLength={5000} className={field} />
              </label>
              <label className={label}>
                <span>Termin spotkania (tylko „BOM umówiony”)</span>
                <input type="datetime-local" name="scheduledAt" className={field} />
              </label>
              <button type="submit" className={btn}>
                Dodaj
              </button>
            </form>
          </details>
        </section>
      </div>

      <section className={panel}>
        <h2 className={h2}>Historia ({contact.events.length})</h2>
        {contact.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak zdarzeń.</p>
        ) : (
          <ol className="border-l-2 border-border pl-4">
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
                {e.scheduledAt && <p className="text-sm text-muted-foreground">Termin: {dateTimeFmt.format(e.scheduledAt)}</p>}
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
      </section>
    </>
  );
}
