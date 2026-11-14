import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PAGE_SIZE, listContacts, listTagNames, parseFilters, type ContactFilters } from "@/lib/contacts";
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
const fieldWrap = "flex min-w-36 flex-col gap-1 text-xs text-muted-foreground max-sm:flex-1 max-sm:basis-36";

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
      <Suspense fallback={<p className="mb-3 text-sm text-muted-foreground">Ładuję kontakty…</p>}>
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
      <p className="mb-3 text-sm text-muted-foreground">
        {total === 0 ? "Brak wyników" : `${from}–${to} z ${total.toLocaleString("pl-PL")}`}
      </p>

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border p-3" method="get" action="/contacts">
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
              <Link href="/contacts">Wyczyść</Link>
            </Button>
          )}
        </div>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Osoba</TableHead>
              <TableHead>Etap</TableHead>
              <TableHead>Kierunek</TableHead>
              <TableHead>Tagi</TableHead>
              <TableHead>Ostatnia aktywność</TableHead>
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
