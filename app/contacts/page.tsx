import type { Metadata } from "next";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import {
  PAGE_SIZE,
  listContacts,
  listTagNames,
  parseFilters,
  type ContactFilters,
  type SortKey,
} from "@/lib/contacts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DIRECTIONS, DIRECTION_LABEL, STAGES, STAGE_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Kontakty · li-crm" };

const dateFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" });

// Pole filtra: etykieta nad kontrolką; na wąskim ekranie pola zajmują pełną szerokość.
// Nagłówek tabeli przyklejony do górnej krawędzi obszaru listy (cień zamiast ramki, bo ramki znikają przy sticky).
const stickyHead = "sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_var(--border)]";
const fieldWrap = "flex min-w-36 flex-col gap-1 text-xs text-muted-foreground max-sm:flex-1 max-sm:basis-36";

function pageHref(f: ContactFilters, page: number): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.stage) p.set("stage", f.stage);
  if (f.direction) p.set("direction", f.direction);
  if (f.tag) p.set("tag", f.tag);
  if (f.otw) p.set("otw", "1");
  if (f.archived !== "active") p.set("archived", f.archived);
  if (f.sort) {
    p.set("sort", f.sort);
    p.set("dir", f.dir || "asc");
  }
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

// Kolumny sortowalne. "Tagi" sortuje po liczbie tagów, "Ostatnia aktywność" po dacie najnowszego zdarzenia.
const COLUMNS: { label: string; key: SortKey; hint?: string }[] = [
  { label: "Osoba", key: "name" },
  { label: "Etap", key: "stage" },
  { label: "Kierunek", key: "direction" },
  { label: "Tagi", key: "tags", hint: "wg liczby tagów" },
  { label: "Ostatnia aktywność", key: "activity" },
];

/** Kliknięcie: rosnąco → malejąco → bez sortowania (kolejność dodania) → rosnąco… Zmiana sortowania wraca na stronę 1. */
function sortHref(f: ContactFilters, key: SortKey): string {
  if (f.sort !== key) return pageHref({ ...f, sort: key, dir: "asc" }, 1);
  if (f.dir === "asc") return pageHref({ ...f, sort: key, dir: "desc" }, 1);
  return pageHref({ ...f, sort: "", dir: "" }, 1);
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// Dane zależą od żądania (searchParams, baza), więc muszą być w <Suspense> (cacheComponents).
export default function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-6xl flex-col gap-3 px-4 pb-3 pt-4">
      <header className="shrink-0">
        <h1 className="text-2xl font-semibold">Kontakty</h1>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję kontakty…</p>}>
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

  const active: string[] = [];
  if (filters.q) active.push(`Szukaj: ${filters.q}`);
  if (filters.stage) active.push(`Etap: ${STAGE_LABEL[filters.stage]}`);
  if (filters.direction) active.push(`Kierunek: ${DIRECTION_LABEL[filters.direction]}`);
  if (filters.tag) active.push(`Tag: ${filters.tag}`);
  if (filters.otw) active.push("Open to work");
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
        <form className="flex max-h-[45dvh] flex-wrap items-end gap-3 overflow-y-auto border-t p-3" method="get" action="/contacts">
          {filters.sort && (
            <>
              <input type="hidden" name="sort" value={filters.sort} />
              <input type="hidden" name="dir" value={filters.dir || "asc"} />
            </>
          )}
          <div className={`${fieldWrap} flex-1 basis-64`}>
            <Label htmlFor="q">Szukaj</Label>
            <Input id="q" type="search" name="q" defaultValue={filters.q} placeholder="Imię, nazwisko lub adres profilu" />
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
            <Label htmlFor="direction">Kierunek</Label>
            <NativeSelect id="direction" name="direction" defaultValue={filters.direction}>
              <NativeSelectOption value="">Wszystkie</NativeSelectOption>
              {DIRECTIONS.map((d) => (
                <NativeSelectOption key={d.value} value={d.value}>
                  {d.label}
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
          <Label className="h-8 gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" name="otw" value="1" defaultChecked={filters.otw} className="size-4 accent-primary" />
            Open to work
          </Label>
          <div className="flex items-center gap-2">
            <Button type="submit">Filtruj</Button>
            {hasFilters && (
              <Button asChild variant="ghost">
                <Link href={pageHref({ ...filters, q: "", stage: "", direction: "", tag: "", otw: false, archived: "active" }, 1)}>Wyczyść</Link>
              </Button>
            )}
          </div>
        </form>
      </details>

      {/* Lista przewija się we własnym obszarze, więc filtry i stronicowanie są zawsze widoczne,
          a nagłówek tabeli przykleja się do góry tego obszaru. */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
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
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/contacts/${c.id}`} className="font-semibold hover:underline">
                      {c.name}
                    </Link>
                    {c.openToWork && <Badge>OTW</Badge>}
                    {c.archived && <Badge variant="outline">zarchiwizowany</Badge>}
                  </div>
                  {c.occupation && <div className="mt-0.5 text-xs text-muted-foreground">{c.occupation}</div>}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {c.location && <span>{c.location} · </span>}
                    <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      LinkedIn ↗
                    </a>
                  </div>
                </TableCell>
                <TableCell>{STAGE_LABEL[c.stage]}</TableCell>
                <TableCell>{DIRECTION_LABEL[c.direction]}</TableCell>
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
              </TableRow>
            ))}
            {contacts.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Żaden kontakt nie pasuje do filtrów.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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
