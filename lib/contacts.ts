import type { Direction, Prisma, Stage } from "@prisma/client";
import { prisma } from "./prisma";
import { DIRECTIONS, STAGES } from "./labels";

export const PAGE_SIZE = 50;

export type ArchivedFilter = "active" | "only" | "all";

export type ContactFilters = {
  q: string;
  stage: Stage | "";
  direction: Direction | "";
  tag: string;
  otw: boolean;
  archived: ArchivedFilter;
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
  return {
    q: first(params.q).trim().slice(0, 100),
    stage: STAGES.some((s) => s.value === stage) ? (stage as Stage) : "",
    direction: DIRECTIONS.some((d) => d.value === direction) ? (direction as Direction) : "",
    tag: first(params.tag).slice(0, 200),
    otw: first(params.otw) === "1",
    archived: archived === "only" || archived === "all" ? archived : "active",
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

export async function listContacts(f: ContactFilters) {
  const where = buildWhere(f);
  const total = await prisma.contact.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(f.page, pages);

  const rows = await prisma.contact.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
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
    },
  });

  // Ostatnia aktywność: najnowsze zdarzenie z prawdziwą datą (bez znaczników dateUnknown, np. 2000-01-01).
  const last = rows.length
    ? await prisma.contactEvent.groupBy({
        by: ["contactId"],
        where: { contactId: { in: rows.map((r) => r.id) }, dateUnknown: false },
        _max: { occurredAt: true },
      })
    : [];
  const lastById = new Map(last.map((l) => [l.contactId, l._max.occurredAt]));

  return {
    total,
    page,
    pages,
    contacts: rows.map((r) => ({
      ...r,
      tags: r.tags.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b, "pl")),
      lastActivity: lastById.get(r.id) ?? null,
    })),
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
