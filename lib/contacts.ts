import type { Prisma, Source, Stage } from "@prisma/client";
import { connection } from "next/server";
import { prisma } from "./prisma";
import { compareNames, parseSearch } from "./contacts-search";
import { addDays, parseDateInput, todayWarsaw } from "./dates";
import { SOURCE_LABEL, STAGES } from "./labels";

export const PAGE_SIZE = 50;

export type ArchivedFilter = "active" | "only" | "all";

/** Wartość filtra "tag" oznaczająca kontakty bez żadnego tagu (nie jest nazwą tagu). */
export const NO_TAG = "__none__";

export const SORT_KEYS = ["name", "occupation", "stage", "tags", "activity", "added"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

/** Kiedy kontakt dodano do bazy (createdAt): dziś, ostatnie 7 / 30 dni (liczone od północy czasu warszawskiego). */
export const ADDED_RANGES = [
  { value: "today", label: "Dziś", days: 1 },
  { value: "7d", label: "Ostatnie 7 dni", days: 7 },
  { value: "30d", label: "Ostatnie 30 dni", days: 30 },
] as const;
export type AddedRange = (typeof ADDED_RANGES)[number]["value"];
const SOURCES = Object.keys(SOURCE_LABEL) as Source[];

export type ContactFilters = {
  /** Imię, nazwisko i adres profilu. */
  q: string;
  location: string;
  occupation: string;
  stage: Stage | "";
  /** Skąd kontakt pochodzi (Contact.source). */
  source: Source | "";
  /** Dodany do bazy w tym zakresie (Contact.createdAt). */
  added: AddedRange | "";
  tag: string;
  otw: boolean;
  /** Tylko kontakty ze zdarzeniem „Wyświetlił(a) mój profil” (znacznik „Viewed”). */
  viewed: boolean;
  /** Wątek LinkedIn: tylko kontakty z zapisanym wątkiem / tylko bez niego. */
  thread: "" | "with" | "without";
  archived: ArchivedFilter;
  /** Pusty = kolejność dodania ("naturalna"), czyli createdAt, id. */
  sort: SortKey | "";
  dir: SortDir | "";
  page: number;
};

type RawParams = { [key: string]: string | string[] | undefined };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Parsuje i waliduje parametry z URL (nic z zewnątrz nie trafia do zapytania bez sprawdzenia). */
export function parseFilters(params: RawParams): ContactFilters {
  const stage = first(params.stage);
  const archived = first(params.archived);
  const source = first(params.source);
  const added = first(params.added);
  const page = Number.parseInt(first(params.page), 10);
  const sort = first(params.sort);
  const validSort = SORT_KEYS.includes(sort as SortKey);
  return {
    q: first(params.q).trim().slice(0, 100),
    location: first(params.location).trim().slice(0, 100),
    occupation: first(params.occupation).trim().slice(0, 100),
    stage: STAGES.some((s) => s.value === stage) ? (stage as Stage) : "",
    source: SOURCES.includes(source as Source) ? (source as Source) : "",
    added: ADDED_RANGES.some((r) => r.value === added) ? (added as AddedRange) : "",
    tag: first(params.tag).slice(0, 200),
    otw: first(params.otw) === "1",
    viewed: first(params.viewed) === "1",
    thread: first(params.thread) === "with" ? "with" : first(params.thread) === "without" ? "without" : "",
    archived: archived === "only" || archived === "all" ? archived : "active",
    sort: validSort ? (sort as SortKey) : "",
    dir: validSort ? (first(params.dir) === "desc" ? "desc" : "asc") : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function buildWhere(f: ContactFilters): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];
  // trzy pola tekstowe o tej samej składni (lib/contacts-search.ts), połączone ORAZ: kolejne pola zawężają wynik
  for (const [text, fields] of [
    [f.q, ["name", "profileUrl"]],
    [f.location, ["location"]],
    [f.occupation, ["occupation"]],
  ] as const) {
    const groups = parseSearch(text);
    if (!groups.length) continue;
    const term = (t: string): Prisma.ContactWhereInput => ({ OR: fields.map((k) => ({ [k]: { contains: t, mode: "insensitive" } })) });
    and.push({ OR: groups.map((g) => ({ AND: g.map(term) })) });
  }
  if (f.stage) and.push({ stage: f.stage });
  if (f.source) and.push({ source: f.source });
  if (f.added) {
    const days = ADDED_RANGES.find((r) => r.value === f.added)!.days;
    const since = parseDateInput(addDays(todayWarsaw(), -(days - 1)));
    if (since) and.push({ createdAt: { gte: since } });
  }
  if (f.tag === NO_TAG) and.push({ tags: { none: {} } });
  else if (f.tag) and.push({ tags: { some: { tag: { name: f.tag } } } });
  if (f.otw) and.push({ openToWork: true });
  if (f.viewed) and.push({ events: { some: { type: "VIEWED_MY_PROFILE" } } });
  if (f.thread === "with") and.push({ threadUrl: { not: null } });
  if (f.thread === "without") and.push({ threadUrl: null });
  if (f.archived === "active") and.push({ archived: false });
  if (f.archived === "only") and.push({ archived: true });
  return and.length ? { AND: and } : {};
}

const SELECT = {
  id: true,
  name: true,
  occupation: true,
  location: true,
  profileUrl: true,
  threadUrl: true,
  source: true,
  createdAt: true,
  stage: true,
  direction: true,
  openToWork: true,
  archived: true,
  tags: { select: { tag: { select: { name: true } } } },
  // znacznik „Viewed” na liście: czy kontakt ma zdarzenie „Wyświetlił(a) mój profil”
  _count: { select: { events: { where: { type: "VIEWED_MY_PROFILE" } } } },
} satisfies Prisma.ContactSelect;

type Row = Prisma.ContactGetPayload<{ select: typeof SELECT }>;

/** Import zostawił w "zajęciu" znaczniki braku danych (".", "--", "..."): na liście traktujemy je jak puste pole. */
export function cleanOccupation(v: string | null): string | null {
  const t = v?.trim() ?? "";
  return t && !/^[-–—.\s]+$/.test(t) ? t : null;
}

function toRow({ _count, ...r }: Row, lastActivity: Date | null) {
  return {
    ...r,
    viewed: _count.events > 0,
    occupation: cleanOccupation(r.occupation),
    tags: r.tags.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b, "pl")),
    lastActivity,
  };
}

/**
 * Kolejność w bazie: Postgres nie gwarantuje żadnej "naturalnej" kolejności bez ORDER BY, a stronicowanie
 * wymaga kolejności stabilnej. Bez sortowania używamy więc kolejności dodania (createdAt, id).
 * Sortowania po nazwie, etapie i tagach robimy w pamięci (idsByColumns): baza ma kolację en_US, która źle układa polskie litery
 * (np. "Ł"), a kolejność w aplikacji nie zależy od ustawień bazy (lokalnej i produkcyjnej).
 */
function orderByFor(f?: ContactFilters): Prisma.ContactOrderByWithRelationInput[] {
  // "Dodano" sortujemy w bazie po createdAt (id dla stabilności); pozostałe przypadki to kolejność dodania rosnąco
  const dir = f?.sort === "added" && f.dir === "desc" ? "desc" : "asc";
  return [{ createdAt: dir }, { id: dir }];
}

// Ostatnia aktywność: najnowsze zdarzenie z prawdziwą datą (bez znaczników dateUnknown, np. 2000-01-01).
async function lastActivityFor(ids?: string[]) {
  const rows = await prisma.contactEvent.groupBy({
    by: ["contactId"],
    where: { dateUnknown: false, ...(ids ? { contactId: { in: ids } } : {}) },
    _max: { occurredAt: true },
  });
  return new Map(rows.map((l) => [l.contactId, l._max.occurredAt]));
}

export async function listContacts(f: ContactFilters) {
  await connection(); // filtr „Dodano” czyta bieżący czas (buildWhere): ma się wykonać przy żądaniu, nie przy prerenderze
  const where = buildWhere(f);
  if (f.sort === "activity") return listByActivity(f, where);
  if (f.sort === "occupation") return listByOccupation(f, where);
  if (f.sort === "name" || f.sort === "stage" || f.sort === "tags") return pageOf(await idsByColumns(f, where), f);

  const total = await prisma.contact.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(f.page, pages);

  const rows = await prisma.contact.findMany({
    where,
    orderBy: orderByFor(f),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: SELECT,
  });
  const lastById = rows.length ? await lastActivityFor(rows.map((r) => r.id)) : new Map<string, Date | null>();

  return { total, page, pages, contacts: rows.map((r) => toRow(r, lastById.get(r.id) ?? null)) };
}

// "Ostatnia aktywność" jest wartością wyliczaną (CLAUDE.md: nie przechowujemy), więc nie da się po niej
// posortować w jednym zapytaniu Prismy. Przy kilku tysiącach kontaktów: pobierz pasujące id + ostatnie daty,
// posortuj w pamięci (kontakty bez daty zawsze na końcu) i dopiero wtedy wczytaj bieżącą stronę.
async function idsByActivity(f: ContactFilters, where: Prisma.ContactWhereInput) {
  const [all, lastById] = await Promise.all([
    prisma.contact.findMany({ where, select: { id: true, name: true } }),
    lastActivityFor(),
  ]);
  const sign = f.dir === "desc" ? -1 : 1;
  all.sort((a, b) => {
    const x = lastById.get(a.id)?.getTime();
    const y = lastById.get(b.id)?.getTime();
    if (x === undefined && y !== undefined) return 1;
    if (x !== undefined && y === undefined) return -1;
    if (x !== undefined && y !== undefined && x !== y) return (x - y) * sign;
    return byName(a, b);
  });

  return { ids: all.map((r) => r.id), lastById };
}

async function listByActivity(f: ContactFilters, where: Prisma.ContactWhereInput) {
  const { ids, lastById } = await idsByActivity(f, where);
  return pageOf(ids, f, lastById);
}

/** Wczytuje bieżącą stronę dla już posortowanej listy id. */
async function pageOf(sortedIds: string[], f: ContactFilters, lastById?: Map<string, Date | null>) {
  const total = sortedIds.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const ids = sortedIds.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const [rows, last] = await Promise.all([
    ids.length ? prisma.contact.findMany({ where: { id: { in: ids } }, select: SELECT }) : [],
    lastById ?? (ids.length ? lastActivityFor(ids) : new Map<string, Date | null>()),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    total,
    page,
    pages,
    contacts: ids.flatMap((id) => {
      const r = byId.get(id);
      return r ? [toRow(r, last.get(id) ?? null)] : [];
    }),
  };
}

// Zajęcie sortujemy w pamięci (jak aktywność): polska kolejność liter (np. "Ł" po "L"), a puste i znaczniki braku danych
// zawsze na końcu, także przy sortowaniu malejącym.
async function idsByOccupation(f: ContactFilters, where: Prisma.ContactWhereInput) {
  const all = await prisma.contact.findMany({ where, select: { id: true, name: true, occupation: true } });
  const sign = f.dir === "desc" ? -1 : 1;
  // klucz bez początkowych znaków specjalnych (cudzysłowy, nawiasy, #, emoji), żeby nagłówki typu "[CEO]" nie lądowały przed literami
  const key = all.map((r) => {
    const occ = cleanOccupation(r.occupation);
    return { id: r.id, name: r.name, occ: occ === null ? null : occ.replace(/^[^\p{L}\p{N}]+/u, "") || occ };
  });
  key.sort((a, b) => {
    if (a.occ === null && b.occ !== null) return 1;
    if (a.occ !== null && b.occ === null) return -1;
    if (a.occ !== null && b.occ !== null) {
      const c = a.occ.localeCompare(b.occ, "pl", { sensitivity: "base" });
      if (c !== 0) return c * sign;
    }
    return byName(a, b);
  });
  return key.map((r) => r.id);
}

async function listByOccupation(f: ContactFilters, where: Prisma.ContactWhereInput) {
  return pageOf(await idsByOccupation(f, where), f);
}

const STAGE_ORDER = new Map(STAGES.map((s, i) => [s.value, i]));
const byName = compareNames;

// Nazwa (cały tekst "Imię Nazwisko", polska kolejność liter), etap (kolejność lejka) i liczba tagów: w pamięci, remisy rozstrzyga nazwa rosnąco.
async function idsByColumns(f: ContactFilters, where: Prisma.ContactWhereInput) {
  const rows = await prisma.contact.findMany({ where, select: { id: true, name: true, stage: true, _count: { select: { tags: true } } } });
  const sign = f.dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    if (f.sort === "name") return byName(a, b) * sign;
    const x = f.sort === "stage" ? (STAGE_ORDER.get(a.stage) ?? 0) - (STAGE_ORDER.get(b.stage) ?? 0) : a._count.tags - b._count.tags;
    return x * sign || byName(a, b);
  });
  return rows.map((r) => r.id);
}

/** Wszystkie id pasujące do filtrów w kolejności listy (do nawigacji "poprzedni / następny" na karcie kontaktu). */
async function allIds(f: ContactFilters): Promise<string[]> {
  await connection(); // jak w listContacts: buildWhere czyta bieżący czas
  const where = buildWhere(f);
  if (f.sort === "activity") return (await idsByActivity(f, where)).ids;
  if (f.sort === "occupation") return idsByOccupation(f, where);
  if (f.sort === "name" || f.sort === "stage" || f.sort === "tags") return idsByColumns(f, where);
  return (await prisma.contact.findMany({ where, orderBy: orderByFor(f), select: { id: true } })).map((r) => r.id);
}

/** Sąsiedzi kontaktu na liście o danych filtrach i sortowaniu; null, gdy kontaktu nie ma na tej liście. */
export async function contactNeighbors(f: ContactFilters, id: string) {
  const ids = await allIds(f);
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return { prev: ids[index - 1] ?? null, next: ids[index + 1] ?? null, position: index + 1, total: ids.length };
}

/** Parametry listy jako zapytanie URL (to samo, co zapisuje strona listy); strona > 1 jest dopisywana. */
export function filtersQuery(f: ContactFilters, page: number): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.location) p.set("location", f.location);
  if (f.occupation) p.set("occupation", f.occupation);
  if (f.stage) p.set("stage", f.stage);
  if (f.source) p.set("source", f.source);
  if (f.added) p.set("added", f.added);
  if (f.tag) p.set("tag", f.tag);
  if (f.otw) p.set("otw", "1");
  if (f.viewed) p.set("viewed", "1");
  if (f.thread) p.set("thread", f.thread);
  if (f.archived !== "active") p.set("archived", f.archived);
  if (f.sort) {
    p.set("sort", f.sort);
    p.set("dir", f.dir || "asc");
  }
  if (page > 1) p.set("page", String(page));
  return p.toString();
}

/** Kontekst listy przekazany w adresie karty (`?from=`): sprawdzony i zapisany od nowa, więc do zapytania nie trafia nic spoza znanych filtrów. */
export function listContextFrom(raw: string | null | undefined): { filters: ContactFilters; query: string } {
  const filters = parseFilters(Object.fromEntries(new URLSearchParams((raw ?? "").slice(0, 600))));
  return { filters, query: filtersQuery(filters, filters.page) };
}

export async function listTagNames(): Promise<string[]> {
  const tags = await prisma.tag.findMany({ select: { name: true } });
  return tags.map((t) => t.name).sort((a, b) => a.localeCompare(b, "pl"));
}

export async function getContact(id: string) {
  return prisma.contact.findUnique({
    where: { id },
    include: {
      tags: { select: { tag: { select: { name: true } } } },
      events: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] },
    },
  });
}
