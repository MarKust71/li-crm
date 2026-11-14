import type { ArchiveReason, Direction, EventType, Source, Stage } from "@prisma/client";

// Etapy w kolejności lejka (do selecta w filtrach i do wyświetlania).
export const STAGES: { value: Stage; label: string }[] = [
  { value: "CAPTURED", label: "Zebrany" },
  { value: "INVITED", label: "Zaproszony" },
  { value: "ACCEPTED", label: "Zaproszenie przyjęte" },
  { value: "THANKED", label: "Podziękowano" },
  { value: "ASKED_OPEN", label: "Zapytano o rozmowę" },
  { value: "OPEN_TO_TALK", label: "Chce rozmawiać" },
  { value: "NOT_INTERESTED", label: "Nie chce rozmawiać" },
  { value: "BOM_PROPOSED", label: "Zaproponowano BOM" },
  { value: "BOM_SCHEDULED", label: "BOM umówiony" },
  { value: "BOM_COMPLETED", label: "BOM odbyty" },
  { value: "DECISION_YES", label: "Decyzja: tak" },
  { value: "DECISION_NO", label: "Decyzja: nie" },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.value, s.label])) as Record<Stage, string>;

export const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "OUTBOUND", label: "Ja zapraszam" },
  { value: "INBOUND", label: "Zaprosili mnie" },
];

export const DIRECTION_LABEL = Object.fromEntries(DIRECTIONS.map((d) => [d.value, d.label])) as Record<
  Direction,
  string
>;


export const EVENT_LABEL: Record<EventType, string> = {
  INVITE_SENT: "Zaproszenie wysłane",
  INVITE_RECEIVED: "Zaproszenie otrzymane",
  INVITE_WITHDRAWN: "Zaproszenie wycofane",
  ACCEPTED: "Zaproszenie zaakceptowane",
  REACTION_RECEIVED: "Reakcja osoby",
  THANKS_SENT: "Podziękowanie wysłane",
  ASKED_OPEN: "Zapytano o otwartość na rozmowę",
  ASKED_OPEN_REMINDER: "Przypomnienie o pytaniu",
  ASKED_OPEN_RESPONSE: "Reakcja na pytanie",
  OPEN_TO_TALK: "Chce rozmawiać",
  NOT_INTERESTED: "Nie chce rozmawiać",
  BOM_PROPOSED: "Zaproponowano BOM",
  BOM_PROPOSAL_REMINDER: "Przypomnienie o propozycji BOM",
  BOM_SCHEDULED: "BOM umówiony",
  BOM_CONFIRMED: "BOM potwierdzony",
  BOM_CANCELED: "BOM odwołany",
  BOM_NO_SHOW: "Nieobecność na BOM",
  BOM_COMPLETED: "BOM odbyty",
  DECISION_YES: "Decyzja: tak",
  DECISION_NO: "Decyzja: nie",
  VIEWED_MY_PROFILE: "Wyświetlił(a) mój profil",
  NOTE: "Notatka",
};

/** Typy dostępne w formularzu "Inne zdarzenie" (kolejność jak w lejku). */
export const ALL_EVENT_TYPES = Object.keys(EVENT_LABEL) as EventType[];

export const ARCHIVE_REASONS: { value: ArchiveReason; label: string }[] = [
  { value: "NO_CONVERSATION", label: "Nie życzy sobie rozmów" },
  { value: "INVITE_REJECTED", label: "Zaproszenie odrzucone / nieaktywne" },
  { value: "OTHER", label: "Inny powód" },
];

export const ARCHIVE_REASON_LABEL = Object.fromEntries(ARCHIVE_REASONS.map((r) => [r.value, r.label])) as Record<
  ArchiveReason,
  string
>;

export const SOURCE_LABEL: Record<Source, string> = {
  SEARCH: "Wyniki wyszukiwania",
  VIEWERS: "Oglądający profil",
  PYMK: "People you may know",
  SUGGESTIONS: "Sugestie zaproszeń",
  PROFILE: "Strona profilu",
  MORE_PROFILES: "More profiles",
  MANUAL: "Ręcznie",
  IMPORT: "Import z arkuszy",
};

// Przyciski następnego kroku zależne od etapu (spec 7.2). Pierwszy = najczęstszy.
const COMMON_NEXT: Partial<Record<Stage, EventType[]>> = {
  INVITED: ["ACCEPTED", "INVITE_WITHDRAWN"],
  ACCEPTED: ["THANKS_SENT", "ASKED_OPEN"],
  THANKED: ["ASKED_OPEN"],
  ASKED_OPEN: ["ASKED_OPEN_RESPONSE", "OPEN_TO_TALK", "NOT_INTERESTED", "ASKED_OPEN_REMINDER"],
  OPEN_TO_TALK: ["BOM_PROPOSED"],
  BOM_PROPOSED: ["BOM_SCHEDULED", "BOM_PROPOSAL_REMINDER"],
  BOM_SCHEDULED: ["BOM_CONFIRMED", "BOM_COMPLETED", "BOM_CANCELED", "BOM_NO_SHOW"],
  BOM_COMPLETED: ["DECISION_YES", "DECISION_NO"],
};

export function nextSteps(stage: Stage, direction: Direction): EventType[] {
  if (stage === "CAPTURED") return [direction === "INBOUND" ? "INVITE_RECEIVED" : "INVITE_SENT"];
  return COMMON_NEXT[stage] ?? [];
}
