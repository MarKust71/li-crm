import type { Direction, Stage } from "@prisma/client";

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
