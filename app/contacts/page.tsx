import type { Metadata } from "next";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import {
  ADDED_RANGES,
  PAGE_SIZE,
  listContacts,
  filtersQuery,
  listTagNames,
  parseFilters,
  type ContactFilters,
  type SortKey,
} from "@/lib/contacts";
import { InfoTip } from "@/components/info-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectAll } from "@/components/select-all";
import { SiteNav } from "@/components/site-nav";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { bulkArchiveAction, bulkUnarchiveAction } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ARCHIVE_REASONS, SOURCE_LABEL, STAGES, STAGE_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Kontakty · li-crm" };

const dateFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" });

// Pole filtra: etykieta nad kontrolką; na wąskim ekranie pola zajmują pełną szerokość.
// Nagłówek tabeli przyklejony do górnej krawędzi obszaru listy (cień zamiast ramki, bo ramki znikają przy sticky).
const stickyHead = "sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_var(--border)]";
const fieldWrap = "flex min-w-36 flex-col gap-1 text-xs text-muted-foreground max-sm:flex-1 max-sm:basis-36";

function pageHref(f: ContactFilters, page: number): string {
  const qs = filtersQuery(f, page);
  return qs ? `/contacts?${qs}` : "/contacts";
}

// Kolumny sortowalne. "Tagi" sortuje po liczbie tagów, "Ostatnia aktywność" po dacie najnowszego zdarzenia.
const COLUMNS: { label: string; key: SortKey; hint?: string }[] = [
  { label: "Osoba", key: "name" },
  { label: "Zajęcie", key: "occupation" },
  { label: "Etap", key: "stage" },
  { label: "Tagi", key: "tags", hint: "wg liczby tagów" },
  { label: "Ostatnia aktywność", key: "activity" },
  { label: "Dodano", key: "added", hint: "data dodania do bazy; pierwsze kliknięcie: najnowsze na górze" },
];

/** Kliknięcie: rosnąco → malejąco → bez sortowania (kolejność dodania) → rosnąco… Zmiana sortowania wraca na stronę 1. */
function sortHref(f: ContactFilters, key: SortKey): string {
  // "Dodano" zaczyna od najnowszych (malejąco), reszta od rosnąco
  const [one, two] = key === "added" ? (["desc", "asc"] as const) : (["asc", "desc"] as const);
  if (f.sort !== key) return pageHref({ ...f, sort: key, dir: one }, 1);
  if (f.dir === one) return pageHref({ ...f, sort: key, dir: two }, 1);
  return pageHref({ ...f, sort: "", dir: "" }, 1);
}

/** Podpowiedź (i) przy polach tekstowych: ta sama składnia we wszystkich trzech. */
function SearchHelp() {
  return (
    <InfoTip label="Jak działa wyszukiwanie">
      <p className="mb-1 font-medium">Pola Szukaj, Lokalizacja i Zajęcie mają tę samą składnię, a ich warunki łączy ORAZ (każde kolejne pole zawęża wynik).</p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>spacja = LUB: <code>dolnośląskie BR</code></li>
        <li>+ = ORAZ: <code>księgowa+BR</code></li>
        <li>cudzysłów = dokładny ciąg: <code>&quot;obsługa klienta&quot;</code></li>
        <li>łączenie: <code>a+b c</code> to (a ORAZ b) LUB c</li>
        <li>Szukaj: imię, nazwisko i adres profilu; Lokalizacja i Zajęcie: tylko to jedno pole</li>
      </ul>
    </InfoTip>
  );
}

/** Link do karty z kontekstem listy (filtry, sortowanie, strona): karta wraca do tej listy i pozwala przejść do sąsiednich kontaktów. */
function cardHref(id: string, f: ContactFilters, page: number): string {
  const qs = filtersQuery(f, page);
  return qs ? `/contacts/${id}?from=${encodeURIComponent(qs)}` : `/contacts/${id}`;
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// Dane zależą od żądania (searchParams, baza), więc muszą być w <Suspense> (cacheComponents).
export default function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-6xl flex-col gap-3 px-4 pb-3 pt-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Kontakty</h1>
        <SiteNav current="contacts" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję kontakty…</p>}>
        <ContactsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ContactsContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const num = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : 0);
  const done = { archived: num(sp.zarchiwizowano), restored: num(sp.przywrocono), skipped: num(sp.pominieto) };
  const [{ contacts, total, page, pages }, tags] = await Promise.all([listContacts(filters), listTagNames()]);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const hasFilters = Boolean(
    filters.q || filters.location || filters.occupation || filters.stage || filters.source || filters.added || filters.tag || filters.otw || filters.thread || filters.archived !== "active",
  );

  const multiOpen = done.archived > 0 || done.restored > 0 || done.skipped > 0 || Boolean(sp.brak || sp.powod);

  const active: string[] = [];
  if (filters.q) active.push(`Szukaj: ${filters.q}`);
  if (filters.location) active.push(`Lokalizacja: ${filters.location}`);
  if (filters.occupation) active.push(`Zajęcie: ${filters.occupation}`);
  if (filters.stage) active.push(`Etap: ${STAGE_LABEL[filters.stage]}`);
  if (filters.source) active.push(`Źródło: ${SOURCE_LABEL[filters.source]}`);
  if (filters.added) active.push(`Dodano: ${ADDED_RANGES.find((r) => r.value === filters.added)!.label}`);
  if (filters.tag) active.push(`Tag: ${filters.tag}`);
  if (filters.otw) active.push("Open to work");
  if (filters.thread) active.push(filters.thread === "with" ? "Z wątkiem" : "Bez wątku");
  if (filters.archived === "only") active.push("Tylko zarchiwizowane");
  if (filters.archived === "all") active.push("Z zarchiwizowanymi");

  return (
    <>
      <p className="shrink-0 text-sm text-muted-foreground">
        {total === 0 ? "Brak wyników" : `${from}–${to} z ${total.toLocaleString("pl-PL")}`}
        {" · "}
        {filters.sort
          ? `sortowanie: ${COLUMNS.find((c) => c.key === filters.sort)?.label} ${filters.dir === "desc" ? "malejąco" : "rosnąco"}`
          : "kolejność dodania"}
      </p>

      {(done.archived > 0 || done.restored > 0 || sp.brak || sp.powod || done.skipped > 0) && (
        <Alert className="shrink-0" variant={sp.brak || sp.powod ? "destructive" : "default"}>
          <AlertDescription>
            {sp.brak && "Nic nie zaznaczono."}
            {sp.powod && "Wybierz powód archiwizacji."}
            {done.archived > 0 && `Zarchiwizowano: ${done.archived}. `}
            {done.restored > 0 && `Przywrócono: ${done.restored}. `}
            {done.skipped > 0 && `Pominięto (już w tym stanie): ${done.skipped}.`}
          </AlertDescription>
        </Alert>
      )}

      <details className="group shrink-0 rounded-lg border" open={hasFilters}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
          Filtry
          <span className="flex flex-wrap gap-1 font-normal">
            {active.map((a) => (
              <Badge key={a} variant="secondary" className="max-w-56 truncate">
                {a}
              </Badge>
            ))}
          </span>
        </summary>
        {/* key z aktualnymi filtrami: po "Wyczyść" lub zmianie adresu pola formularza są tworzone od nowa (defaultValue nie nadpisuje wpisanego już tekstu) */}
        <form
          key={JSON.stringify([filters.q, filters.location, filters.occupation, filters.stage, filters.source, filters.added, filters.tag, filters.otw, filters.thread, filters.archived])}
          className="flex max-h-[45dvh] flex-wrap items-end gap-3 overflow-y-auto border-t p-3"
          method="get"
          action="/contacts"
        >
          {filters.sort && (
            <>
              <input type="hidden" name="sort" value={filters.sort} />
              <input type="hidden" name="dir" value={filters.dir || "asc"} />
            </>
          )}
          <div className={`${fieldWrap} flex-1 basis-56`}>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="q">Szukaj</Label>
              <SearchHelp />
            </div>
            <Input id="q" type="search" name="q" defaultValue={filters.q} />
          </div>
          <div className={`${fieldWrap} flex-1 basis-48`}>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="location">Lokalizacja</Label>
              <SearchHelp />
            </div>
            <Input id="location" type="search" name="location" defaultValue={filters.location} />
          </div>
          <div className={`${fieldWrap} flex-1 basis-48`}>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="occupation">Zajęcie</Label>
              <SearchHelp />
            </div>
            <Input id="occupation" type="search" name="occupation" defaultValue={filters.occupation} />
          </div>
          <div className={fieldWrap}>
            <Label htmlFor="stage">Etap</Label>
            <NativeSelect id="stage" name="stage" defaultValue={filters.stage}>
              <NativeSelectOption value="">Wszystkie</NativeSelectOption>
              {STAGES.map((s) => (
                <NativeSelectOption key={s.value} value={s.value}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className={fieldWrap}>
            <Label htmlFor="source">Źródło</Label>
            <NativeSelect id="source" name="source" defaultValue={filters.source}>
              <NativeSelectOption value="">Wszystkie</NativeSelectOption>
              {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className={fieldWrap}>
            <Label htmlFor="added">Dodano</Label>
            <NativeSelect id="added" name="added" defaultValue={filters.added}>
              <NativeSelectOption value="">Kiedykolwiek</NativeSelectOption>
              {ADDED_RANGES.map((r) => (
                <NativeSelectOption key={r.value} value={r.value}>
                  {r.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className={fieldWrap}>
            <Label htmlFor="tag">Tag</Label>
            <NativeSelect id="tag" name="tag" defaultValue={filters.tag}>
              <NativeSelectOption value="">Wszystkie</NativeSelectOption>
              {tags.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {t}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className={fieldWrap}>
            <Label htmlFor="archived">Zarchiwizowane</Label>
            <NativeSelect id="archived" name="archived" defaultValue={filters.archived}>
              <NativeSelectOption value="active">Ukryte</NativeSelectOption>
              <NativeSelectOption value="only">Tylko zarchiwizowane</NativeSelectOption>
              <NativeSelectOption value="all">Wszystkie</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className={fieldWrap}>
            <Label htmlFor="thread">Wątek</Label>
            <NativeSelect id="thread" name="thread" defaultValue={filters.thread}>
              <NativeSelectOption value="">Wszystkie</NativeSelectOption>
              <NativeSelectOption value="with">Z wątkiem</NativeSelectOption>
              <NativeSelectOption value="without">Bez wątku</NativeSelectOption>
            </NativeSelect>
          </div>
          <Label className="h-8 gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" name="otw" value="1" defaultChecked={filters.otw} className="size-4 accent-primary" />
            Open to work
          </Label>
          <div className="flex items-center gap-2">
            <Button type="submit">Filtruj</Button>
            {hasFilters && (
              <Button asChild variant="ghost">
                <Link href={pageHref({ ...filters, q: "", location: "", occupation: "", stage: "", source: "", added: "", tag: "", otw: false, thread: "", archived: "active" }, 1)}>Wyczyść</Link>
              </Button>
            )}
          </div>
        </form>
      </details>

      {/* Lista przewija się we własnym obszarze, więc filtry i stronicowanie są zawsze widoczne,
          a nagłówek tabeli przykleja się do góry tego obszaru. */}
      {/* group/multi: kolumna z checkboxami jest widoczna tylko przy otwartym panelu „Multiwybór" (czysty CSS, bez JS) */}
      <form className="group/multi flex min-h-0 flex-1 flex-col gap-3">
        <input type="hidden" name="back" value={pageHref(filters, page)} />
        {contacts.length > 0 && (
          <details className="multi group shrink-0 rounded-lg border" open={multiOpen}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
              Multiwybór
            </summary>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t p-3">
            <SelectAll />
            {filters.archived !== "only" && (
              <>
                <NativeSelect name="reason" defaultValue="NO_CONVERSATION" aria-label="Powód archiwizacji" className="w-auto">
                  {ARCHIVE_REASONS.map((r) => (
                    <NativeSelectOption key={r.value} value={r.value}>
                      {r.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" name="cancelReminders" defaultChecked className="size-4 accent-primary" />
                  Anuluj otwarte przypomnienia
                </label>
                <SubmitButton formAction={bulkArchiveAction} variant="outline" pendingLabel="Archiwizuję…">
                  Archiwizuj zaznaczone
                </SubmitButton>
              </>
            )}
            {filters.archived !== "active" && (
              <SubmitButton formAction={bulkUnarchiveAction} variant="outline" pendingLabel="Przywracam…">
                Przywróć zaznaczone
              </SubmitButton>
            )}
            </div>
          </details>
        )}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead className={`${stickyHead} hidden w-8 group-has-[.multi[open]]/multi:table-cell`}>
                <span className="sr-only">Zaznacz</span>
              </TableHead>
              {COLUMNS.map((c) => {
                const active = filters.sort === c.key;
                const asc = active && filters.dir === "asc";
                const Icon = !active ? ChevronsUpDown : asc ? ArrowUp : ArrowDown;
                const next = !active ? "rosnąco" : asc ? "malejąco" : "kolejność dodania";
                return (
                  <TableHead
                    key={c.key}
                    className={stickyHead}
                    aria-sort={!active ? "none" : asc ? "ascending" : "descending"}
                  >
                    <Link
                      href={sortHref(filters, c.key)}
                      title={`Sortuj: ${next}${c.hint ? ` (${c.hint})` : ""}`}
                      className={`inline-flex items-center gap-1 ${active ? "text-foreground" : "hover:text-foreground"}`}
                    >
                      {c.label}
                      <Icon className={`size-3.5 ${active ? "" : "opacity-40"}`} aria-hidden />
                    </Link>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id} className={c.archived ? "opacity-60" : undefined}>
                <TableCell className="hidden w-8 group-has-[.multi[open]]/multi:table-cell">
                  <input type="checkbox" name="ids" value={c.id} aria-label={`Zaznacz: ${c.name}`} className="size-4 accent-primary" />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={cardHref(c.id, filters, page)} className="font-semibold hover:underline">
                      {c.name}
                    </Link>
                    {c.openToWork && <Badge>OTW</Badge>}
                    {c.archived && <Badge variant="outline">zarchiwizowany</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {c.location && <span>{c.location} · </span>}
                    {/* kontakt z zapisanym wątkiem ma link „Rozmowa” zamiast „Profil”: od razu widać, którym brakuje wątku */}
                    {c.threadUrl ? (
                      <a href={c.threadUrl} target="_blank" rel="noopener noreferrer" className="underline" title="Otwórz rozmowę na LinkedIn">
                        Rozmowa ↗
                      </a>
                    ) : (
                      <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className="underline" title="Otwórz profil na LinkedIn">
                        Profil ↗
                      </a>
                    )}
                  </div>
                </TableCell>
                <TableCell className="min-w-48 max-w-80 whitespace-normal" title={c.occupation ?? undefined}>
                  {c.occupation ? <span className="line-clamp-3">{c.occupation}</span> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>{STAGE_LABEL[c.stage]}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex max-w-72 flex-wrap gap-1">
                    {c.tags.slice(0, 3).map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                    {c.tags.length > 3 && <Badge variant="outline">+{c.tags.length - 3}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{c.lastActivity ? dateFormat.format(c.lastActivity) : "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  <div>{dateFormat.format(c.createdAt)}</div>
                  <div className="text-xs text-muted-foreground">{SOURCE_LABEL[c.source]}</div>
                </TableCell>
              </TableRow>
            ))}
            {contacts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Żaden kontakt nie pasuje do filtrów.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      </form>

      {pages > 1 && (
        <nav className="flex shrink-0 items-center justify-between gap-3 text-sm" aria-label="Strony">
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
