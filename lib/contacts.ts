import type { Direction, Prisma, Stage } from "@prisma/client";
import { prisma } from "./prisma";
import { DIRECTIONS, STAGES } from "./labels";

export const PAGE_SIZE = 50;

export type ArchivedFilter = "active" | "only" | "all";

export const SORT_KEYS = ["name", "stage", "direction", "tags", "activity"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export type ContactFilters = {
  q: string;
  stage: Stage | "";
  direction: Direction | "";
  tag: string;
  otw: boolean;
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
  const direction = first(params.direction);
  const archived = first(params.archived);
  const page = Number.parseInt(first(params.page), 10);
  const sort = first(params.sort);
  const validSort = SORT_KEYS.includes(sort as SortKey);
  return {
    q: first(params.q).trim().slice(0, 100),
    stage: STAGES.some((s) => s.value === stage) ? (stage as Stage) : "",
    direction: DIRECTIONS.some((d) => d.value === direction) ? (direction as Direction) : "",
    tag: first(params.tag).slice(0, 200),
    otw: first(params.otw) === "1",
    archived: archived === "only" || archived === "all" ? archived : "active",
    sort: validSort ? (sort as SortKey) : "",
    dir: validSort ? (first(params.dir) === "desc" ? "desc" : "asc") : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function buildWhere(f: ContactFilters): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];
  if (f.q) {
    and.push({
      OR: [
        { name: { contains: f.q, mode: "insensitive" } },
        { profileUrl: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  if (f.stage) and.push({ stage: f.stage });
  if (f.direction) and.push({ direction: f.direction });
  if (f.tag) and.push({ tags: { some: { tag: { name: f.tag } } } });
  if (f.otw) and.push({ openToWork: true });
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
  stage: true,
  direction: true,
  openToWork: true,
  archived: true,
  tags: { select: { tag: { select: { name: true } } } },
} satisfies Prisma.ContactSelect;

type Row = Prisma.ContactGetPayload<{ select: typeof SELECT }>;

function toRow(r: Row, lastActivity: Date | null) {
  return {
    ...r,
    tags: r.tags.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b, "pl")),
    lastActivity,
  };
}

/**
 * Kolejność w bazie: Postgres nie gwarantuje żadnej "naturalnej" kolejności bez ORDER BY, a stronicowanie
 * wymaga kolejności stabilnej. Bez sortowania używamy więc kolejności dodania (createdAt, id).
 * Etap sortuje się wg kolejności wartości enuma, czyli kolejności lejka.
 */
function orderByFor(f: ContactFilters): Prisma.ContactOrderByWithRelationInput[] {
  const d: SortDir = f.dir || "asc";
  switch (f.sort) {
    case "name":
      return [{ name: d }, { id: "asc" }];
    case "stage":
      return [{ stage: d }, { name: "asc" }, { id: "asc" }];
    case "direction":
      return [{ direction: d }, { name: "asc" }, { id: "asc" }];
    case "tags": // liczba tagów
      return [{ tags: { _count: d } }, { name: "asc" }, { id: "asc" }];
    default:
      return [{ createdAt: "asc" }, { id: "asc" }];
  }
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
  const where = buildWhere(f);
  if (f.sort === "activity") return listByActivity(f, where);

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
async function listByActivity(f: ContactFilters, where: Prisma.ContactWhereInput) {
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
    return a.name.localeCompare(b.name, "pl") || a.id.localeCompare(b.id);
  });

  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const ids = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => r.id);
  const rows = ids.length ? await prisma.contact.findMany({ where: { id: { in: ids } }, select: SELECT }) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  return {
    total,
    page,
    pages,
    contacts: ids.flatMap((id) => {
      const r = byId.get(id);
      return r ? [toRow(r, lastById.get(id) ?? null)] : [];
    }),
  };
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
      events: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] },
    },
  });
}
