import type { EventType, Stage } from "@prisma/client";

// Jedyne miejsce wyliczania Contact.stage (CLAUDE.md). Etap = najpóźniejszy etap
// (wg kolejności enuma Stage) spośród zdarzeń lejka. NOTE i VIEWED_MY_PROFILE go nie zmieniają.
const ORDER: Stage[] = [
  "CAPTURED",
  "INVITED",
  "ACCEPTED",
  "THANKED",
  "ASKED_OPEN",
  "OPEN_TO_TALK",
  "NOT_INTERESTED",
  "BOM_PROPOSED",
  "BOM_SCHEDULED",
  "BOM_COMPLETED",
  "DECISION_YES",
  "DECISION_NO",
];

const EVENT_STAGE: Partial<Record<EventType, Stage>> = {
  INVITE_SENT: "INVITED",
  INVITE_RECEIVED: "INVITED",
  ACCEPTED: "ACCEPTED",
  REACTION_RECEIVED: "ACCEPTED",
  THANKS_SENT: "THANKED",
  ASKED_OPEN: "ASKED_OPEN",
  ASKED_OPEN_REMINDER: "ASKED_OPEN",
  ASKED_OPEN_RESPONSE: "ASKED_OPEN",
  NOT_NOW: "ASKED_OPEN", // odpowiedź na pytanie bez zamykania: etap zostaje "Zapytano o rozmowę"
  OPEN_TO_TALK: "OPEN_TO_TALK",
  NOT_INTERESTED: "NOT_INTERESTED",
  BOM_PROPOSED: "BOM_PROPOSED",
  BOM_PROPOSAL_REMINDER: "BOM_PROPOSED",
  BOM_SCHEDULED: "BOM_SCHEDULED",
  BOM_CONFIRMED: "BOM_SCHEDULED",
  BOM_CANCELED: "BOM_SCHEDULED",
  BOM_NO_SHOW: "BOM_SCHEDULED",
  BOM_COMPLETED: "BOM_COMPLETED",
  DECISION_YES: "DECISION_YES",
  DECISION_NO: "DECISION_NO",
};

type StageEvent = { type: EventType; occurredAt?: Date; createdAt?: Date };

const INVITE_TYPES: EventType[] = ["INVITE_SENT", "INVITE_RECEIVED", "INVITE_WITHDRAWN"];

// Wycofanie zaproszenia cofa kontakt do "Zebrany": zdarzenia zaproszenia do ostatniego wycofania włącznie
// się nie liczą. Nowe INVITE_SENT/INVITE_RECEIVED po wycofaniu znów daje "Zaproszony". Kolejność:
// occurredAt, potem createdAt (gdy podane), a bez dat kolejność wejściowa.
export function computeStage(events: StageEvent[]): Stage {
  const t = (d?: Date) => d?.getTime() ?? 0;
  const sorted = [...events].sort((a, b) => t(a.occurredAt) - t(b.occurredAt) || t(a.createdAt) - t(b.createdAt));
  const lastWithdrawn = sorted.map((e) => e.type).lastIndexOf("INVITE_WITHDRAWN");
  let best = 0;
  sorted.forEach((e, i) => {
    if (i <= lastWithdrawn && INVITE_TYPES.includes(e.type)) return;
    const s = EVENT_STAGE[e.type];
    if (s) best = Math.max(best, ORDER.indexOf(s));
  });
  return ORDER[best];
}
