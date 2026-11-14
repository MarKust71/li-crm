import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PAGE_SIZE, listContacts, listTagNames, parseFilters, type ContactFilters } from "@/lib/contacts";
import { DIRECTIONS, DIRECTION_LABEL, STAGES, STAGE_LABEL } from "@/lib/labels";
import styles from "./contacts.module.css";

export const metadata: Metadata = { title: "Kontakty · li-crm" };

const dateFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" });

function pageHref(f: ContactFilters, page: number): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.stage) p.set("stage", f.stage);
  if (f.direction) p.set("direction", f.direction);
  if (f.tag) p.set("tag", f.tag);
  if (f.otw) p.set("otw", "1");
  if (f.archived !== "active") p.set("archived", f.archived);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// Dane zależą od żądania (searchParams, baza), więc muszą być w <Suspense> (cacheComponents).
export default function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Kontakty</h1>
      </header>
      <Suspense fallback={<p className={styles.count}>Ładuję kontakty…</p>}>
        <ContactsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ContactsContent({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams);
  const [{ contacts, total, page, pages }, tags] = await Promise.all([listContacts(filters), listTagNames()]);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const hasFilters = Boolean(
    filters.q || filters.stage || filters.direction || filters.tag || filters.otw || filters.archived !== "active",
  );

  return (
    <>
      <p className={styles.count}>
        {total === 0 ? "Brak wyników" : `${from}–${to} z ${total.toLocaleString("pl-PL")}`}
      </p>

      <form className={styles.filters} method="get" action="/contacts">
        <label className={styles.search}>
          <span>Szukaj</span>
          <input type="search" name="q" defaultValue={filters.q} placeholder="Imię, nazwisko lub adres profilu" />
        </label>
        <label>
          <span>Etap</span>
          <select name="stage" defaultValue={filters.stage}>
            <option value="">Wszystkie</option>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Kierunek</span>
          <select name="direction" defaultValue={filters.direction}>
            <option value="">Wszystkie</option>
            {DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Tag</span>
          <select name="tag" defaultValue={filters.tag}>
            <option value="">Wszystkie</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Zarchiwizowane</span>
          <select name="archived" defaultValue={filters.archived}>
            <option value="active">Ukryte</option>
            <option value="only">Tylko zarchiwizowane</option>
            <option value="all">Wszystkie</option>
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" name="otw" value="1" defaultChecked={filters.otw} />
          <span>Open to work</span>
        </label>
        <div className={styles.actions}>
          <button type="submit">Filtruj</button>
          {hasFilters && (
            <Link href="/contacts" className={styles.reset}>
              Wyczyść
            </Link>
          )}
        </div>
      </form>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Osoba</th>
              <th>Etap</th>
              <th>Kierunek</th>
              <th>Tagi</th>
              <th>Ostatnia aktywność</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id} className={c.archived ? styles.archived : undefined}>
                <td>
                  <div className={styles.person}>
                    <Link href={`/contacts/${c.id}`} className={styles.name}>
                      <strong>{c.name}</strong>
                    </Link>
                    {c.openToWork && <span className={styles.badge}>OTW</span>}
                    {c.archived && <span className={styles.badgeMuted}>zarchiwizowany</span>}
                  </div>
                  {c.occupation && <div className={styles.sub}>{c.occupation}</div>}
                  <div className={styles.sub}>
                    {c.location && <span>{c.location} · </span>}
                    <a href={c.profileUrl} target="_blank" rel="noopener noreferrer">
                      LinkedIn ↗
                    </a>
                  </div>
                </td>
                <td>{STAGE_LABEL[c.stage]}</td>
                <td>{DIRECTION_LABEL[c.direction]}</td>
                <td>
                  <div className={styles.tags}>
                    {c.tags.slice(0, 3).map((t) => (
                      <span key={t} className={styles.tag}>
                        {t}
                      </span>
                    ))}
                    {c.tags.length > 3 && <span className={styles.tagMore}>+{c.tags.length - 3}</span>}
                  </div>
                </td>
                <td className={styles.date}>{c.lastActivity ? dateFormat.format(c.lastActivity) : "—"}</td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  Żaden kontakt nie pasuje do filtrów.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className={styles.pager} aria-label="Strony">
          {page > 1 ? <Link href={pageHref(filters, page - 1)}>← Poprzednia</Link> : <span />}
          <span>
            Strona {page} z {pages}
          </span>
          {page < pages ? <Link href={pageHref(filters, page + 1)}>Następna →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
