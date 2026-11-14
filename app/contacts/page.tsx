import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PAGE_SIZE, listContacts, listTagNames, parseFilters, type ContactFilters } from "@/lib/contacts";
import { DIRECTIONS, DIRECTION_LABEL, STAGES, STAGE_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Kontakty · li-crm" };

const dateFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" });

// Wspólne style (do czasu przejścia na komponenty shadcn).
const label = "flex flex-col gap-1 text-xs text-muted max-sm:flex-1 max-sm:basis-36";
const field =
  "min-w-36 rounded-md border border-line bg-background px-2 py-1.5 text-sm text-foreground max-sm:w-full max-sm:min-w-0";
const pill = "inline-block whitespace-nowrap rounded-full px-2 py-px text-xs";
const th =
  "whitespace-nowrap border-b border-line bg-soft px-3 py-2.5 text-left align-top text-xs font-semibold uppercase tracking-wide text-muted";
const td = "border-b border-line px-3 py-2.5 align-top";

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
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Kontakty</h1>
      </header>
      <Suspense fallback={<p className="mb-3 text-sm text-muted">Ładuję kontakty…</p>}>
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
      <p className="mb-3 text-sm text-muted">
        {total === 0 ? "Brak wyników" : `${from}–${to} z ${total.toLocaleString("pl-PL")}`}
      </p>

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line p-3" method="get" action="/contacts">
        <label className={`${label} flex-1 basis-64`}>
          <span>Szukaj</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Imię, nazwisko lub adres profilu"
            className={`${field} w-full`}
          />
        </label>
        <label className={label}>
          <span>Etap</span>
          <select name="stage" defaultValue={filters.stage} className={field}>
            <option value="">Wszystkie</option>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Kierunek</span>
          <select name="direction" defaultValue={filters.direction} className={field}>
            <option value="">Wszystkie</option>
            {DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Tag</span>
          <select name="tag" defaultValue={filters.tag} className={field}>
            <option value="">Wszystkie</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Zarchiwizowane</span>
          <select name="archived" defaultValue={filters.archived} className={field}>
            <option value="active">Ukryte</option>
            <option value="only">Tylko zarchiwizowane</option>
            <option value="all">Wszystkie</option>
          </select>
        </label>
        <label className="flex flex-row items-center gap-1.5 pb-2 text-xs text-muted">
          <input type="checkbox" name="otw" value="1" defaultChecked={filters.otw} />
          <span>Open to work</span>
        </label>
        <div className="flex items-center gap-3 pb-0.5">
          <button type="submit" className="cursor-pointer rounded-md bg-foreground px-4 py-2 text-sm text-background">
            Filtruj
          </button>
          {hasFilters && (
            <Link href="/contacts" className="text-sm text-muted">
              Wyczyść
            </Link>
          )}
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>Osoba</th>
              <th className={th}>Etap</th>
              <th className={th}>Kierunek</th>
              <th className={th}>Tagi</th>
              <th className={th}>Ostatnia aktywność</th>
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>td]:border-b-0">
            {contacts.map((c) => (
              <tr key={c.id} className={c.archived ? "opacity-60" : undefined}>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/contacts/${c.id}`} className="hover:underline">
                      <strong>{c.name}</strong>
                    </Link>
                    {c.openToWork && <span className={`${pill} bg-foreground text-background`}>OTW</span>}
                    {c.archived && <span className={`${pill} border border-line bg-soft`}>zarchiwizowany</span>}
                  </div>
                  {c.occupation && <div className="mt-0.5 text-xs text-muted">{c.occupation}</div>}
                  <div className="mt-0.5 text-xs text-muted">
                    {c.location && <span>{c.location} · </span>}
                    <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      LinkedIn ↗
                    </a>
                  </div>
                </td>
                <td className={td}>{STAGE_LABEL[c.stage]}</td>
                <td className={td}>{DIRECTION_LABEL[c.direction]}</td>
                <td className={td}>
                  <div className="flex max-w-72 flex-wrap gap-1">
                    {c.tags.slice(0, 3).map((t) => (
                      <span key={t} className={`${pill} border border-line bg-soft`}>
                        {t}
                      </span>
                    ))}
                    {c.tags.length > 3 && (
                      <span className={`${pill} border border-line bg-soft text-muted`}>+{c.tags.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {c.lastActivity ? dateFormat.format(c.lastActivity) : "—"}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  Żaden kontakt nie pasuje do filtrów.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Strony">
          {page > 1 ? (
            <Link href={pageHref(filters, page - 1)} className="underline">
              ← Poprzednia
            </Link>
          ) : (
            <span />
          )}
          <span>
            Strona {page} z {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(filters, page + 1)} className="underline">
              Następna →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
