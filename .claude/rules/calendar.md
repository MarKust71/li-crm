---
paths:
  - "lib/calendar-*.ts"
  - "lib/meeting-sync-core.ts"
  - "lib/contact-events.ts"
  - "lib/settings.ts"
  - "app/api/sync/**"
  - "app/settings/**"
  - "scripts/*calendar*.ts"
---

# Kalendarz: wydarzenia i spotkania

- Opis i lokalizacja wydarzeń w kalendarzu: opis (`buildDescription`: profil, wątek, `CRM: <AUTH_ORIGIN>/contacts/<id>`, notatka, e-mail, telefon, znacznik ID)
  jest wysyłany przy `create` i przy każdym `update` (nadpisuje opis w całości, ręczne dopiski w Google znikają). Spotkania BOM i FU mają też
  `location` = ustawienie „Domyślny link BOM” (`meeting.defaultLink` w `AppSetting`, `getMeetingLink` w `lib/settings.ts`; domyślnie
  `https://mydmb.pl/c/mk/zoom`, pusty zapis = bez lokalizacji). Zmiana linku w „Ustawienia” i zmiana imienia/profilu/wątku/e-maila/telefonu kontaktu
  oznaczają `PENDING` nadchodzące spotkania i otwarte przypomnienia kontaktu, które mają wydarzenie (`markUpcomingMeetingsPending`,
  `markContactCalendarPending` w `lib/contact-events.ts`). Workflow n8n musi mapować `description` i `location` w gałęziach create i update.
  Jednorazowo dla istniejących: `scripts/refresh-calendar-events.ts`.

- Spotkania w kalendarzu to zdarzenia `BOM_SCHEDULED` i `FOLLOW_UP` z `scheduledAt`. Stan BOM (odbyty `v `, nieobecność `x `,
  odwołany = usunięcie wydarzenia) wynika z historii kontaktu (`meetingOutcome`). `FOLLOW_UP` wymaga terminu i odbytego BOM
  (`BOM_COMPLETED`) i nie zmienia etapu. Usunięcie takiego zdarzenia zostawia `CalendarTombstone`, żeby n8n skasował wydarzenie.
