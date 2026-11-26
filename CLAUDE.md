# li-crm

Prywatny CRM do pracy z kontaktami z LinkedIn. Zastępuje trzy arkusze Google
(lejek kontaktów, dane z rozszerzenia przeglądarki, dziennik czasu pracy).
Jeden użytkownik: właściciel projektu.

Pełna specyfikacja, mapowanie kolumn arkuszy i otwarte pytania: `docs/spec.md`.
Schemat bazy: `prisma/schema.prisma`.

## Stack

- Next.js (App Router, TypeScript) na Vercel, funkcje w regionie `fra1` (ustawia `vercel.json`; ten sam region co baza, `eu-central-1`: inaczej
  każde zapytanie leci między regionami i zapis trwa kilka sekund)
- PostgreSQL: dev w lokalnym Dockerze, produkcja w Prisma Postgres (`db.prisma.io`), dostęp przez Prisma
- Logowanie: własna implementacja dla jednego użytkownika (bez Auth.js): hasło (scrypt) i sesja w podpisanym
  ciasteczku (JWT, `jose`), bramka w `proxy.ts`, klucze dostępu/Touch ID (`@simplewebauthn`)
- n8n (`n8n.dmb24.pl`): webhook z rozszerzenia (dziś zapis do arkusza, przepięcie na bazę otwarte), synchronizacja
  z Kalendarzem Google, powiadomienia Telegram i dzienny raport e-mail przez SMTP (workflowy odpytują aplikację przez `/api/sync/*` i `/api/notify/*`)

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
- Każdy przycisk zapisujący dane to `SubmitButton` (`components/submit-button.tsx`, nie `<Button type="submit">`), z `pendingLabel` zależnym od akcji
  („Zapisuję…”, „Dodaję…”, „Usuwam…”; przy przyciskach z samą ikoną wystarczy kółko). Do końca akcji blokuje wszystkie przyciski formularza, a kółko
  ma tylko kliknięty (w formularzu z kilkoma przyciskami muszą się różnić `formAction` albo parą `name`/`value`). Przyciski bez formularza (`onClick`)
  blokują się własnym stanem i pokazują `Spinner`. Okno potwierdzenia z zapisem zostaje otwarte do końca akcji: `usePendingDialog`, `PendingWatch`
  i `PendingCancel` (`components/pending-dialog.tsx`) zamiast `AlertDialogAction`/`AlertDialogCancel`. Formularze `method="get"` (filtry) tego nie dotyczą.
- Arkusze Google są tylko źródłem importu. Nie zapisujemy do nich.
- Synchronizacja z Kalendarzem Google "dMb" idzie przez n8n (workflow "li-crm: synchronizacja z Kalendarzem Google", pyta aplikację
  przez `/api/sync/*` z nagłówkiem `x-api-key`). Logika jest w aplikacji: czyste funkcje w `lib/calendar-sync-core.ts` i
  `lib/meeting-sync-core.ts`, baza w `lib/calendar-sync.ts`. Tryb (minuty / `0` ręcznie / `-1` wyłączona) ustawia się w "Ustawienia".
  Każda zmiana przypomnienia i spotkania oznacza wiersz `syncState = PENDING`; nowe operacje na kalendarzu dopisuj tak samo.
- Decyzja zamyka kontakt: dodanie `DECISION_YES` / `DECISION_NO` (w `addEventTx`, więc z UI i z kalendarza) archiwizuje kontakt z powodem
  `DECISION_MADE` ("Decyzja podjęta") i anuluje jego otwarte przypomnienia (`setArchivedTx`, wpis `contact.archived` z `auto: true`).
  Już zarchiwizowany zostaje przy swoim powodzie i dacie. Usunięcie zdarzenia decyzji NIE przywraca kontaktu (robi się to ręcznie).
  Tak samo `NOT_INTERESTED` („Nie chce rozmawiać") archiwizuje z powodem `NO_CONVERSATION` („Nie życzy sobie rozmów"); mapa zdarzenie→powód to
  `AUTO_ARCHIVE_REASON` w `lib/contact-events.ts`. Usunięcie takiego zdarzenia też nie przywraca kontaktu. Bez migracji (powód już istniał).
- Przypomnienia po "Zapytano o otwartość na rozmowę" (`ASKED_OPEN`, `applyEventAutomations` w `lib/reminders.ts`): trzy automatyczne
  (`source = AUTO`, `kind = REMINDER`) po 7 dniach, 4 tygodniach (28 dni) i 6 miesiącach od daty zdarzenia, z gotową treścią w `note`
  (`followUp*Message` w `lib/invite-message.ts`; zwrot z `salutation` wpisany w chwili utworzenia, bez zwrotu pomijany, forma męska
  przy "Pan…/Panie…"). Powtórne pytanie nie dubluje otwartych. Odpowiedź (`ASKED_OPEN_RESPONSE`, `OPEN_TO_TALK`, `NOT_INTERESTED`)
  albo usunięcie jedynego `ASKED_OPEN` anuluje otwarte (`cancelFollowUps`).
  W UI (karta kontaktu) dodanie `ASKED_OPEN` poprzedza pytanie „Czy dodać standardowe powiadomienia?” Tak/Nie/Anuluj (`components/asked-open-form.tsx`,
  pole `standardReminders` → `skipFollowUps` w `addContactEvent`/`addEventTx`/`applyEventAutomations`); Nie = zdarzenie bez przypomnień. Kalendarz,
  import i skrypty nie pytają (domyślnie przypomnienia powstają).
  Wyjątek: `NOT_NOW` („Nie teraz", odpowiedź na pytanie o rozmowę) nie anuluje przypomnień, nie archiwizuje i nie zmienia etapu (zostaje
  „Zapytano o rozmowę", `lib/stage.ts`); w statystykach to osobny krok `notNow` pod „Zapytano o rozmowę". Bez zmian schematu: rozpoznajemy je po AUTO + REMINDER.
- Dziennik aktywności (`/log`, tabela `ActivityLog`): każda zmiana danych, przebieg synchronizacji, powiadomienie i logowanie zostawia wpis
  przez `logActivity` (`lib/activity-log.ts`), wołany z warstwy domenowej, a nie z UI (żeby zmiany z synchronizacji też się logowały).
  Nowe mutacje dopisuj tak samo. Nigdy nie loguj haseł, kluczy, treści wiadomości ani e-maili/telefonów. Retencja 180 dni (automatycznie, raz na dobę).
- Dopisek „(po X dniach)” przy „Zaproszenie zaakceptowane” (`ACCEPTED`): dni kalendarzowe (czas warszawski) od ostatniego `INVITE_SENT` sprzed przyjęcia
  (`acceptDelaySuffix` w `lib/accept-delay.ts`, czysta funkcja; 1 → „po 1 dniu”). Brak dopisku, gdy nie ma zaproszenia, gdy zaproszenie lub przyjęcie ma
  `dateUnknown` (znacznik 2000-01-01) albo różnica jest ujemna. Pokazywany w historii na karcie kontaktu (liczony przy renderze, nie zapisywany) i w wpisach
  dziennika `event.added` / `event.deleted` (`lib/contact-events.ts`; stare wpisy bez zmian). Nowe miejsca pokazujące `ACCEPTED` używają tej funkcji.
- Podpowiedzi czasu pracy (pasek `TimeBar` w `app/layout.tsx`) opierają się na dzienniku aktywności: nowe akcje użytkownika logujesz
  `logActivity` ze źródłem `UI`, a akcje niebędące pracą w CRM dostają prefiks `time.`, `settings.` lub `log.`. Pasek niczego nie zatrzymuje sam.
- Pauza w czasie pracy (`TimeEntry.pausedAt`, `pausedSeconds`, `lib/time.ts`): sesja w toku może być wstrzymana (nadal `endedAt = null`, więc
  nadal najwyżej jedna). Czas netto = koniec − początek − `pausedSeconds` i tak liczą wszystkie sumy w zapytaniach (`SECS` w `lib/time.ts`,
  z `GREATEST(0, …)`); nowe zapytania o czas pracy też muszą odejmować przerwy. Zatrzymanie w pauzie kończy wpis w chwili jej rozpoczęcia.
  `pauseSession`/`resumeSession` są odporne na podwójne kliknięcie (warunek w `updateMany`). Pasek `TimeBar` (`lib/time-assist-core.ts`):
  po `pauseMinutes` bezczynności (domyślnie 15, 0 = wyłączone) proponuje wstrzymanie; dłuższa bezczynność (`idleMinutes`) ma pierwszeństwo i
  proponuje zakończenie; w pauzie, gdy w aplikacji coś się dzieje, proponuje wznowienie. Wznowienie liczy się jak aktywność (`time.resumed`
  w dzienniku), żeby pasek nie proponował pauzy zaraz po nim.
- Znacznik "Viewed" (lista kontaktów i nagłówek karty) to pochodna zdarzeń `VIEWED_MY_PROFILE` (bez pola w schemacie). Ręczne dodanie z karty
  wymaga potwierdzenia (`markViewedAction`, praktycznie nieodwracalne). Oglądanie bez znanej daty = data 2000-01-01 (`VIEWED_UNKNOWN_DATE`,
  `lib/viewed.ts`) z `dateUnknown = true`; wsteczne uzupełnienie z arkuszy: `scripts/backfill-viewed.ts` (wykonane na prod 2026-11-18).
  Lista kontaktów ma filtr `viewed=1` (pole wyboru „Viewed”, `parseFilters`/`buildWhere`/`filtersQuery`; kryterium: zdarzenie `VIEWED_MY_PROFILE`; spec 13.5).
- Szczegóły funkcji są w `.claude/rules/` (kalendarz, statystyki i dashboard, powiadomienia i raport, dane z rozszerzenia, szkic BOM, LinkedIn)
  i ładują się przy pasujących plikach. Przed planowaniem zmian w którejś z nich przeczytaj odpowiedni plik.
- Kontaktów nie usuwamy: błędny kontakt się archiwizuje.
- Adresu e-mail raportu dziennego nie wpisywać do repozytorium ani dziennika.
- `_linkedin-probe/` to prawdziwe dane osobowe: nie commitować, nie wypisywać wartości; `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` tylko w `.env.local`.

## Środowiska

- Dev: Postgres w lokalnym Dockerze (`docker compose up -d db`).
- Prod: Prisma Postgres (`db.prisma.io`), połączenie z Vercela przez SSL; klucze w zmiennych środowiskowych Vercela.
  Migracje na produkcji stosuje się ręcznie (`prisma migrate deploy`) **przed** wdrożeniem kodu, który z nich korzysta
  (build na Vercelu ich nie uruchamia).

- Kopie zapasowe: dostawca (Prisma Starter) robi je co 3 h, retencja 7 dni; własny zrzut: `npm run backup` (`scripts/backup-db.ts`,
  `pg_dump` w kontenerze `li-crm-db`, do `_backups/`, rotacja 8; produkcja przez `BACKUP_DATABASE_URL`). Spec 2.1.

- Kopia produkcji do dev: `npm run db:pull-prod` (`scripts/pull-prod.ts`, `-- --yes` bez pytania). Robi kopię lokalnej bazy, zrzut produkcji
  (tylko odczyt, adres z `BACKUP_DATABASE_URL` lub `DIRECT_URL` z `.env.production.local`) i NADPISUJE lokalną bazę (`DROP SCHEMA public`);
  odmawia, gdy `DATABASE_URL` nie jest localhost. Lokalnie są wtedy prawdziwe dane osobowe: nie podpinaj kluczy `SYNC_API_KEY`/`INGEST_API_KEY`
  produkcji ani n8n do lokalnej aplikacji (kalendarz, Telegram). Spec 2.1.

## Zmienne środowiskowe

- `DATABASE_URL`, `DIRECT_URL`
- `AUTH_SECRET` (klucz podpisu sesji, min. 32 znaki) i `AUTH_PASSWORD_HASH` (skrót hasła z `npm run hash-password`).
  W produkcji bez nich aplikacja nic nie serwuje (503); lokalnie bez nich logowanie jest wyłączone
- `AUTH_RP_ID` i `AUTH_ORIGIN` (np. `li-crm.mydmb.pl` i `https://li-crm.mydmb.pl`): domena kluczy dostępu (Touch ID).
  Klucz jest przypięty do domeny; zmiana domeny wymaga ponownej rejestracji kluczy (hasło działa zawsze)
- `INGEST_API_KEY` – klucz (min. 24 znaki) endpointów `/api/ingest/*` przyjmujących dane z rozszerzenia przez n8n (`x-api-key`); na produkcji trzeba go ustawić na Vercelu
- `SYNC_API_KEY` – klucz (min. 24 znaki) endpointów `/api/sync/*` dla n8n; ta sama wartość w poświadczeniu Header Auth w n8n (`x-api-key`)
- `BOM_DRAFT_WEBHOOK_URL` i `BOM_DRAFT_API_KEY` – adres webhooka n8n (tajna ścieżka) i klucz `x-api-key` dla szkicu e-maila po umówieniu BOM; wartość klucza = poświadczenie n8n "Header Auth account | li-crm bom-draft". Bez adresu aplikacja nie woła n8n (lokalnie zostaw puste: wychodziłyby prawdziwe dane)
