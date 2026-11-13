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
  INVITE_WITHDRAWN: "INVITED", // wycofać można tylko wysłane zaproszenie
  ACCEPTED: "ACCEPTED",
  REACTION_RECEIVED: "ACCEPTED",
  THANKS_SENT: "THANKED",
  ASKED_OPEN: "ASKED_OPEN",
  ASKED_OPEN_REMINDER: "ASKED_OPEN",
  ASKED_OPEN_RESPONSE: "ASKED_OPEN",
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

export function computeStage(events: { type: EventType }[]): Stage {
  let best = 0;
  for (const e of events) {
    const s = EVENT_STAGE[e.type];
    if (s) best = Math.max(best, ORDER.indexOf(s));
  }
  return ORDER[best];
}
