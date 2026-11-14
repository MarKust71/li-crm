import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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
import styles from "./card.module.css";

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

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default function ContactPage({ params, searchParams }: Props) {
  return (
    <main className={styles.main}>
      <Link href="/contacts" className={styles.back}>
        ← Kontakty
      </Link>
      <Suspense fallback={<p className={styles.muted}>Ładuję kontakt…</p>}>
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
      <header className={styles.header}>
        <div>
          <h1>{contact.name}</h1>
          {contact.occupation && <p className={styles.occupation}>{contact.occupation}</p>}
        </div>
        <div className={styles.badges}>
          <span className={styles.stage}>{STAGE_LABEL[contact.stage]}</span>
          {contact.openToWork && <span className={styles.badge}>OTW</span>}
          {contact.archived && <span className={styles.badgeMuted}>zarchiwizowany</span>}
        </div>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>Dane</h2>
          <dl className={styles.data}>
            <dt>Profil</dt>
            <dd>
              <a href={contact.profileUrl} target="_blank" rel="noopener noreferrer">
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
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
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
                <dd className={styles.tags}>
                  {tags.map((t) => (
                    <span key={t} className={styles.tag}>
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
              <h3>Notatki</h3>
              <p className={styles.info}>{contact.info}</p>
            </>
          )}

          <details className={styles.details}>
            <summary>Edytuj dane</summary>
            <form action={updateDetailsAction} className={styles.form}>
              <input type="hidden" name="id" value={contact.id} />
              <label>
                <span>Zwrot (np. „Pani Aniu”)</span>
                <input name="salutation" defaultValue={contact.salutation ?? ""} maxLength={100} />
              </label>
              <label>
                <span>E-mail</span>
                <input name="email" type="email" defaultValue={contact.email ?? ""} maxLength={200} />
              </label>
              <label>
                <span>Telefon</span>
                <input name="phone" defaultValue={contact.phone ?? ""} maxLength={50} />
              </label>
              <label>
                <span>Notatki</span>
                <textarea name="info" rows={5} defaultValue={contact.info ?? ""} maxLength={10000} />
              </label>
              <button type="submit">Zapisz</button>
            </form>
          </details>

          <details className={styles.details}>
            <summary>{contact.archived ? "Przywróć kontakt" : "Archiwizuj"}</summary>
            {contact.archived ? (
              <form action={unarchiveAction} className={styles.form}>
                <input type="hidden" name="id" value={contact.id} />
                <button type="submit">Przywróć z archiwum</button>
              </form>
            ) : (
              <form action={archiveAction} className={styles.form}>
                <input type="hidden" name="id" value={contact.id} />
                <label>
                  <span>Powód</span>
                  <select name="reason" defaultValue="NO_CONVERSATION">
                    {ARCHIVE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Archiwizuj</button>
              </form>
            )}
          </details>
        </section>

        <section className={styles.panel}>
          <h2>Następny krok</h2>
          <form action={addEventAction} className={styles.form}>
            <input type="hidden" name="id" value={contact.id} />
            <label>
              <span>Data</span>
              <input type="date" name="date" defaultValue={today} required />
            </label>
            <label>
              <span>Treść wiadomości (opcjonalnie)</span>
              <textarea name="message" rows={3} maxLength={5000} />
            </label>
            {steps.includes("BOM_SCHEDULED") && (
              <label>
                <span>Termin spotkania (dla „BOM umówiony”)</span>
                <input type="datetime-local" name="scheduledAt" />
              </label>
            )}
            {steps.length > 0 ? (
              <div className={styles.buttons}>
                {steps.map((t, i) => (
                  <button key={t} type="submit" name="type" value={t} className={i === 0 ? styles.primary : undefined}>
                    {EVENT_LABEL[t]}
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.muted}>Dla tego etapu nie ma proponowanego kroku. Użyj „Inne zdarzenie”.</p>
            )}
          </form>

          <details className={styles.details}>
            <summary>Inne zdarzenie</summary>
            <form action={addEventAction} className={styles.form}>
              <input type="hidden" name="id" value={contact.id} />
              <label>
                <span>Typ</span>
                <select name="type" defaultValue="NOTE">
                  {ALL_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EVENT_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Data</span>
                <input type="date" name="date" defaultValue={today} required />
              </label>
              <label>
                <span>Treść / notatka</span>
                <textarea name="message" rows={3} maxLength={5000} />
              </label>
              <label>
                <span>Termin spotkania (tylko „BOM umówiony”)</span>
                <input type="datetime-local" name="scheduledAt" />
              </label>
              <button type="submit">Dodaj</button>
            </form>
          </details>
        </section>
      </div>

      <section className={styles.panel}>
        <h2>Historia ({contact.events.length})</h2>
        {contact.events.length === 0 ? (
          <p className={styles.muted}>Brak zdarzeń.</p>
        ) : (
          <ol className={styles.timeline}>
            {contact.events.map((e) => (
              <li key={e.id}>
                <div className={styles.eventHead}>
                  <span className={styles.eventDate}>
                    {dateFmt.format(e.occurredAt)}
                    {e.dateUnknown && <em className={styles.unknown}> · data nieznana</em>}
                  </span>
                  <strong>{EVENT_LABEL[e.type]}</strong>
                </div>
                {e.scheduledAt && <p className={styles.sub}>Termin: {dateTimeFmt.format(e.scheduledAt)}</p>}
                {e.message && <p className={styles.message}>{e.message}</p>}
                <details className={styles.delete}>
                  <summary>usuń</summary>
                  <form action={deleteEventAction}>
                    <input type="hidden" name="eventId" value={e.id} />
                    <button type="submit">Potwierdź usunięcie</button>
                  </form>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
