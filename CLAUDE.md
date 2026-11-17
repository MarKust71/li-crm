# li-crm

Prywatny CRM do pracy z kontaktami z LinkedIn. Zastępuje trzy arkusze Google
(lejek kontaktów, dane z rozszerzenia przeglądarki, dziennik czasu pracy).
Jeden użytkownik: właściciel projektu.

Pełna specyfikacja, mapowanie kolumn arkuszy i otwarte pytania: `docs/spec.md`.
Schemat bazy: `prisma/schema.prisma`.

## Stack

- Next.js (App Router, TypeScript) na Vercel, funkcje w regionie `fra1`
- PostgreSQL: dev w lokalnym Dockerze, produkcja w Prisma Postgres (`db.prisma.io`), dostęp przez Prisma
- Logowanie: własna implementacja dla jednego użytkownika (bez Auth.js): hasło (scrypt) i sesja w podpisanym
  ciasteczku (JWT, `jose`), bramka w `proxy.ts`, klucze dostępu/Touch ID (`@simplewebauthn`)
- n8n (`n8n.dmb24.pl`): webhook z rozszerzenia (dziś zapis do arkusza, przepięcie na bazę otwarte), synchronizacja
  z Kalendarzem Google i powiadomienia Telegram (workflowy odpytują aplikację przez `/api/sync/*` i `/api/notify/*`)

## Zasady

- Bez funkcji specyficznych dla Supabase (Auth, RLS z `auth.uid()`, Storage,
  `supabase-js`). Baza ma pozostać zwykłym Postgresem, żeby ewentualna
  migracja do Supabase była tylko `pg_dump`/`pg_restore` + zmianą `DATABASE_URL`.
- Zmiany schematu wyłącznie przez migracje Prismy (`prisma migrate dev`).
- `profileUrl` zawsze normalizowany przed zapisem i wyszukiwaniem (spec 6.1).
  To klucz unikalności kontaktu.
- `Contact.stage` jest pochodną zdarzeń. Każde dodanie/usunięcie
  `ContactEvent` przelicza etap w jednej funkcji (`lib/stage.ts`).
- Wartości liczone (Delay, statystyki, średnie czasu) liczymy w zapytaniach,
  nie przechowujemy.
- Sekrety tylko w zmiennych środowiskowych. Nigdy w repozytorium.
- Każda Server Action zaczyna się od `await requireAccess()` (`lib/access.ts`): proxy nie jest pełną autoryzacją.
  Unieważnienie wszystkich sesji = zmiana `AUTH_SECRET`.
- UI i komunikaty po polsku, identyfikatory w kodzie po angielsku.
- Arkusze Google są tylko źródłem importu. Nie zapisujemy do nich.
- Synchronizacja z Kalendarzem Google "dMb" idzie przez n8n (workflow "li-crm: synchronizacja z Kalendarzem Google", pyta aplikację
  przez `/api/sync/*` z nagłówkiem `x-api-key`). Logika jest w aplikacji: czyste funkcje w `lib/calendar-sync-core.ts` i
  `lib/meeting-sync-core.ts`, baza w `lib/calendar-sync.ts`. Tryb (minuty / `0` ręcznie / `-1` wyłączona) ustawia się w "Ustawienia".
  Każda zmiana przypomnienia i spotkania oznacza wiersz `syncState = PENDING`; nowe operacje na kalendarzu dopisuj tak samo.
- Statystyki (`/stats`, zastępują arkusz "Summary") są liczone w zapytaniach (`lib/stats.ts`, czyste definicje w `lib/stats-core.ts`),
  nie przechowywane. Liczą osoby, nie zdarzenia; zdarzenia z `dateUnknown` pomijamy wszędzie, gdzie liczy się czas. Konwersje liczone
  na kohorcie (osoby z pierwszym zaproszeniem w okresie); granice okresu to północ czasu warszawskiego.
- Dashboard (`/dashboard`, strona startowa: `/` i logowanie przekierowują tu; `getDashboard` w `lib/stats.ts`, okresy w `dashboardPeriods`
  w `lib/stats-core.ts`) liczy tylko wysłane zaproszenia (kontakty `OUTBOUND`, `INVITE_SENT`), bez tagów i kierunku, osoby, nie zdarzenia.
  Trzy wielkości (zaproszenia, przyjęte i % zaproszeń, zapytania o rozmowę i % przyjętych) w wierszach-okresach, kroki flow w poziomie.
  Dwa przełączniki w URL: `okres` (`rolling` = wstecz od dziś: 7/30/365 dni; `calendar` = od poniedziałku / 1. dnia miesiąca / 1 stycznia)
  i `kohorta` (domyślnie wyłączona = każdy krok osobno w okresie, procenty mogą przekraczać 100%; `kohorta=1` = ścisła: przyjęcie wymaga
  zaproszenia w tym samym okresie, zapytanie o rozmowę przyjęcia i zaproszenia). Do tego zawsze "Od początku roku biznesowego" / "Ten rok
  biznesowy" (start 1 września: `FISCAL_START_MONTH`) i "Cały okres" (od początku danych). To inna definicja kohorty niż w `/stats`
  (tam: pierwsze zaproszenie w okresie, przyjęcie kiedykolwiek), więc liczby obu stron mogą się różnić.
- Powiadomienia Telegram: aplikacja układa treść i decyduje, co wysłać (`lib/notify-core.ts`, `lib/notify.ts`, endpointy
  `/api/notify/pending` i `/result`, ten sam `SYNC_API_KEY`); n8n (workflow "li-crm: powiadomienia Telegram", co minutę) tylko wysyła
  i potwierdza. Wiadomość liczy się jako wysłana dopiero po potwierdzeniu (`SentNotification`). Ustawienia w "Ustawienia".
- Spotkania w kalendarzu to zdarzenia `BOM_SCHEDULED` i `FOLLOW_UP` z `scheduledAt`. Stan BOM (odbyty `v `, nieobecność `x `,
  odwołany = usunięcie wydarzenia) wynika z historii kontaktu (`meetingOutcome`). `FOLLOW_UP` wymaga terminu i odbytego BOM
  (`BOM_COMPLETED`) i nie zmienia etapu. Usunięcie takiego zdarzenia zostawia `CalendarTombstone`, żeby n8n skasował wydarzenie.

- Przypomnienia po "Zapytano o otwartość na rozmowę" (`ASKED_OPEN`, `applyEventAutomations` w `lib/reminders.ts`): trzy automatyczne
  (`source = AUTO`, `kind = REMINDER`) po 7 dniach, 4 tygodniach (28 dni) i 6 miesiącach od daty zdarzenia, z gotową treścią w `note`
  (`followUp*Message` w `lib/invite-message.ts`; zwrot z `salutation` wpisany w chwili utworzenia, bez zwrotu pomijany, forma męska
  przy "Pan…/Panie…"). Powtórne pytanie nie dubluje otwartych. Odpowiedź (`ASKED_OPEN_RESPONSE`, `OPEN_TO_TALK`, `NOT_INTERESTED`)
  albo usunięcie jedynego `ASKED_OPEN` anuluje otwarte (`cancelFollowUps`). Bez zmian schematu: rozpoznajemy je po AUTO + REMINDER.

- Dziennik aktywności (`/log`, tabela `ActivityLog`): każda zmiana danych, przebieg synchronizacji, powiadomienie i logowanie zostawia wpis
  przez `logActivity` (`lib/activity-log.ts`), wołany z warstwy domenowej, a nie z UI (żeby zmiany z synchronizacji też się logowały).
  Nowe mutacje dopisuj tak samo. Nigdy nie loguj haseł, kluczy, treści wiadomości ani e-maili/telefonów. Retencja 180 dni (automatycznie, raz na dobę).

- Podpowiedzi czasu pracy (pasek `TimeBar` w `app/layout.tsx`) opierają się na dzienniku aktywności: nowe akcje użytkownika logujesz
  `logActivity` ze źródłem `UI`, a akcje niebędące pracą w CRM dostają prefiks `time.`, `settings.` lub `log.`. Pasek niczego nie zatrzymuje sam.

- Pauza w czasie pracy (`TimeEntry.pausedAt`, `pausedSeconds`, `lib/time.ts`): sesja w toku może być wstrzymana (nadal `endedAt = null`, więc
  nadal najwyżej jedna). Czas netto = koniec − początek − `pausedSeconds` i tak liczą wszystkie sumy w zapytaniach (`SECS` w `lib/time.ts`,
  z `GREATEST(0, …)`); nowe zapytania o czas pracy też muszą odejmować przerwy. Zatrzymanie w pauzie kończy wpis w chwili jej rozpoczęcia.
  `pauseSession`/`resumeSession` są odporne na podwójne kliknięcie (warunek w `updateMany`). Pasek `TimeBar` (`lib/time-assist-core.ts`):
  po `pauseMinutes` bezczynności (domyślnie 15, 0 = wyłączone) proponuje wstrzymanie; dłuższa bezczynność (`idleMinutes`) ma pierwszeństwo i
  proponuje zakończenie; w pauzie, gdy w aplikacji coś się dzieje, proponuje wznowienie. Wznowienie liczy się jak aktywność (`time.resumed`
  w dzienniku), żeby pasek nie proponował pauzy zaraz po nim.

- Dane z rozszerzenia wchodzą przez `/api/ingest/*` (`lib/ingest-core.ts`, `lib/ingest.ts`): aplikacja normalizuje adres profilu, tworzy kontakty "Zebrany"
  i zdarzenia, składa raport dla Telegrama; n8n tylko przekazuje i wysyła. Wpisy dziennika ze źródłem `SYNC`, nie `UI` (nie liczą się jako praca w CRM).

## Środowiska

- Dev: Postgres w lokalnym Dockerze (`docker compose up -d db`).
- Prod: Prisma Postgres (`db.prisma.io`), połączenie z Vercela przez SSL; klucze w zmiennych środowiskowych Vercela.
  Migracje na produkcji stosuje się ręcznie (`prisma migrate deploy`) **przed** wdrożeniem kodu, który z nich korzysta
  (build na Vercelu ich nie uruchamia).

## Zmienne środowiskowe

- `DATABASE_URL`, `DIRECT_URL`
- `AUTH_SECRET` (klucz podpisu sesji, min. 32 znaki) i `AUTH_PASSWORD_HASH` (skrót hasła z `npm run hash-password`).
  W produkcji bez nich aplikacja nic nie serwuje (503); lokalnie bez nich logowanie jest wyłączone
- `AUTH_RP_ID` i `AUTH_ORIGIN` (np. `li-crm.mydmb.pl` i `https://li-crm.mydmb.pl`): domena kluczy dostępu (Touch ID).
  Klucz jest przypięty do domeny; zmiana domeny wymaga ponownej rejestracji kluczy (hasło działa zawsze)
- `INGEST_API_KEY` – klucz (min. 24 znaki) endpointów `/api/ingest/*` przyjmujących dane z rozszerzenia przez n8n (`x-api-key`); na produkcji trzeba go ustawić na Vercelu
- `SYNC_API_KEY` – klucz (min. 24 znaki) endpointów `/api/sync/*` dla n8n; ta sama wartość w poświadczeniu Header Auth w n8n (`x-api-key`)
