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
- Opis i lokalizacja wydarzeń w kalendarzu: opis (`buildDescription`: profil, wątek, `CRM: <AUTH_ORIGIN>/contacts/<id>`, notatka, e-mail, telefon, znacznik ID)
  jest wysyłany przy `create` i przy każdym `update` (nadpisuje opis w całości, ręczne dopiski w Google znikają). Spotkania BOM i FU mają też
  `location` = ustawienie „Domyślny link BOM” (`meeting.defaultLink` w `AppSetting`, `getMeetingLink` w `lib/settings.ts`; domyślnie
  `https://mydmb.pl/c/mk/zoom`, pusty zapis = bez lokalizacji). Zmiana linku w „Ustawienia” i zmiana imienia/profilu/wątku/e-maila/telefonu kontaktu
  oznaczają `PENDING` nadchodzące spotkania i otwarte przypomnienia kontaktu, które mają wydarzenie (`markUpcomingMeetingsPending`,
  `markContactCalendarPending` w `lib/contact-events.ts`). Workflow n8n musi mapować `description` i `location` w gałęziach create i update.
  Jednorazowo dla istniejących: `scripts/refresh-calendar-events.ts`.

- Statystyki (`/stats`, zastępują arkusz "Summary") są liczone w zapytaniach (`lib/stats.ts`, czyste definicje w `lib/stats-core.ts`),
  nie przechowywane. Liczą osoby, nie zdarzenia; zdarzenia z `dateUnknown` pomijamy wszędzie, gdzie liczy się czas. Konwersje liczone
  na kohorcie (osoby z pierwszym zaproszeniem w okresie); granice okresu to północ czasu warszawskiego.
- Dashboard (`/dashboard`, strona startowa: `/` i logowanie przekierowują tu; `getDashboard` w `lib/stats.ts`, okresy w `dashboardPeriods`
  w `lib/stats-core.ts`) liczy tylko wysłane zaproszenia (kontakty `OUTBOUND`, `INVITE_SENT`), bez tagów i kierunku, osoby, nie zdarzenia.
  Trzy wielkości (zaproszenia, przyjęte i % zaproszeń, zapytania o rozmowę i % przyjętych) w wierszach-okresach, kroki flow w poziomie.
  Wiersze od góry: Dziś, Wczoraj (poprzedni dzień kalendarzowy, `to` = dziś, więc bez dzisiejszych zdarzeń; w obu trybach), tydzień/30 dni lub miesiąc, rok, rok biznesowy, cały okres.
  Podpis zakresu dat w nagłówku wiersza liczy koniec z `period.to − 1 dzień`, nie z „dziś”.
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

- Raport dzienny e-mailem (`lib/report-core.ts` treść i termin, `lib/report.ts` zapytania): jeden mail za poprzedni dzień kalendarzowy
  (czas warszawski), od ustawionej godziny (domyślnie 00:00), także gdy nic się nie działo. Adres i godzina w „Ustawienia” (`report.*` w `AppSetting`;
  bez adresu nic nie wychodzi; adresu nie wpisywać do repozytorium ani dziennika). Idzie tym samym `/api/notify/pending` co Telegram: wiadomość z
  `channel: "email"` (`to`, `subject`, `html`, `text`), n8n wysyła ją przez SMTP (poświadczenie "SMTP account mitax.pl", nadawca no-reply@mitax.pl);
  bez `channel` = Telegram. Klucze `report:<dzień>` i `reporttest:<ts>`. Aplikacja nie ma haseł SMTP.
  Definicje (osoby, nie zdarzenia; `dateUnknown` pomijane w liczbach z datą): zaproszenia i przyjęcia jak na dashboardzie (OUTBOUND z `INVITE_SENT`;
  „z tego już przyjęte” = przyjęcie tego samego dnia), podziękowania i pytania o otwartość ze wszystkich kontaktów; cel: pytań ≥ podziękowań
  (dzień i bilans 7 dni). Zaległości = niezarchiwizowane kontakty z etapem `THANKED` (czekają na pytanie; okna 3/7/30 dni wg daty podziękowania)
  i `ACCEPTED` (czekają na podziękowanie; 7/30 dni wg daty przyjęcia), „razem” obejmuje też te bez znanej daty; liczone wg stanu w chwili wysyłki.

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

- Dane z rozszerzenia wchodzą przez `/api/ingest/*` (`lib/ingest-core.ts`, `lib/ingest.ts`): aplikacja normalizuje adres profilu, tworzy kontakty "Zebrany"
  i zdarzenia, składa raport dla Telegrama; n8n tylko przekazuje i wysyła. Wpisy dziennika ze źródłem `SYNC`, nie `UI` (nie liczą się jako praca w CRM).
  Profil ze strony `/in/` (`content6.js`, `source = profile_page`): `/api/ingest/profile`; uzupełnia tylko puste pola, "Open to work" ustawia wg odczytu w obie strony (`PRAWDA`/`false`; brak pola = bez zmiany; spec 13.2).
  Popup "People you may know" (`content4.js`, `source = people_you_may_know`): `/api/ingest/people-you-may-know`; nowe osoby NIE są kontaktami, trafiają do
  poczekalni (`Candidate`, `lib/candidates.ts`, strona `/inbox`), skąd użytkownik dodaje wybranych jako kontakty (`source = PYMK`) albo odrzuca (odrzuceni nie wracają).
  „More profiles” (`content7.js`, `source = more_profiles`): `/api/ingest/more-profiles`, ten sam przebieg i poczekalnia (`source = MORE_PROFILES`; spec 13.3a); „Open to work” po `alt` zdjęcia jak w PYMK (rozszerzenie od 2.6.9; wcześniej `content7.js` go nie wysyłał). W n8n (`li-contact-data`) czwarta gałąź po `body.source`.
  Lista oglądających też idzie przez poczekalnię (wpis `source = VIEWERS` + `CandidateView`, po dodaniu kontaktu stają się zdarzeniami `VIEWED_MY_PROFILE`; spec 13.1).
  "Open to work" znanym kontaktom ustawiamy wg odczytu w obie strony we wszystkich trzech importach (`syncOpenToWork` w `lib/ingest.ts`; brak pola = bez zmiany). Kontaktów nie usuwamy: błędny kontakt się archiwizuje. Adres profilu da się poprawić w „Edytuj dane” (`updateDetailsAction`: `normalizeProfileUrl`, błąd przy niepoprawnym i przy zajętym przez inny kontakt, bo `profileUrl` jest unikalny; przy zajętym komunikat ma link do kontaktu, który go ma: parametr URL `taken`). Lista kontaktów filtruje po źródle i dacie dodania i sortuje po "Dodano" (spec 13.5); filtr to parametry URL, nowe filtry dopisuj w `parseFilters`/`buildWhere`/`filtersQuery`. Kontakt założony inną drogą czyści swój wpis w poczekalni (`dropCandidates`). Spec 13.3 i 13.4.
  Dziennik trzech masowych importów (oglądający, PYMK, More profiles) mówi, kogo dotyczy zmiana (`logPeople` w `lib/ingest.ts`, treść `contactChangeText` w `lib/ingest-core.ts`):
  jeden wpis `ingest.contact_updated` na zmieniony kontakt (z `contactId`; wyświetlenie, zajęcie, „Open to work” razem, zamiast osobnego `contact.open_to_work`) i `ingest.candidate_queued`
  na nową osobę w poczekalni; osoby bez zmian, już czekające i odrzucone zostają tylko w liczbach wpisu zbiorczego. Telegram zawiera jak dotąd liczby i do 10 nowych nazwisk.

- Szkic e-maila po umówieniu BOM (`BOM_SCHEDULED`): aplikacja składa cały mail (`lib/bom-draft-core.ts`: treść jak w przypomnieniu dzień przed, ale bez „jutro”,
  podpis ze zdjęciem z `lib/signature-photo.ts`, MIME base64url) i woła webhook n8n (`lib/bom-draft.ts`, przez `after()` po zapisie). Bez odpytywania. Zdarzenie NIE jest powiązane
  ze szkicem (nie zapisujemy id szkicu z Gmaila): każda zmiana danych widocznych w mailu daje NOWY szkic, starego nie ruszamy ani nie usuwamy. Wyzwalacze: dodanie `BOM_SCHEDULED`
  (`addEventTx`, `scheduleBomDraft`), zmiana jego terminu z kalendarza (`applyMeetingChange`), zmiana e-maila lub zwrotu kontaktu (`updateContactDetails`,
  `scheduleBomDraftsForContact`: wszystkie jego nadchodzące BOM, więc dodany później e-mail tworzy pierwszy szkic), zmiana „Domyślnego linku BOM” (`saveMeetingLinkAction`,
  `scheduleBomDraftsForLinkChange`: tylko BOM, które już miały szkic). Nowe dane w szkicu dopisuj do odcisku w `bomDraftKey`. Adres webhooka z tajną ścieżką to
  `BOM_DRAFT_WEBHOOK_URL` i klucz `BOM_DRAFT_API_KEY` (nagłówek `x-api-key`, poświadczenie n8n "Header Auth account | li-crm bom-draft"; bez adresu aplikacja nie woła n8n, więc lokalnie nic nie wychodzi).
  Warunki: BOM otwarty, termin w przyszłości, kontakt z e-mailem i niezarchiwizowany, link = „Domyślny link BOM”. n8n (workflow "li-crm: szkic e-maila po umówieniu BOM (webhook)")
  tworzy szkic w Gmailu, odpowiada `{ok}` i powiadamia na Telegramie; nic nie wysyła. Idempotencja: `SentNotification` z kluczem `bomdraft:<id zdarzenia>:<odcisk: termin, e-mail, zwrot, link>`
  zapisywanym po potwierdzeniu (zapis bez zmiany treści niczego nie dubluje); wynik w dzienniku (`bomdraft.created`/`bomdraft.failed`). Brak ponowień: po błędzie szkic trzeba zrobić ręcznie.
  Stary workflow "BP reminder drafts (Gmail)" (szkic dzień przed) działa równolegle.

- Znacznik "Viewed" (lista kontaktów i nagłówek karty) to pochodna zdarzeń `VIEWED_MY_PROFILE` (bez pola w schemacie). Ręczne dodanie z karty
  wymaga potwierdzenia (`markViewedAction`, praktycznie nieodwracalne). Oglądanie bez znanej daty = data 2000-01-01 (`VIEWED_UNKNOWN_DATE`,
  `lib/viewed.ts`) z `dateUnknown = true`; wsteczne uzupełnienie z arkuszy: `scripts/backfill-viewed.ts` (wykonane na prod 2026-11-18).
  Lista kontaktów ma filtr `viewed=1` (pole wyboru „Viewed”, `parseFilters`/`buildWhere`/`filtersQuery`; kryterium: zdarzenie `VIEWED_MY_PROFILE`; spec 13.5).

- Badanie LinkedIn Member Data Portability API (3rd Party): `scripts/linkedin-probe.ts` (`npm run linkedin:probe`, spec 13.6), tylko sonda, nic nie trafia do bazy.
  Wyniki z prawdziwymi danymi osobowymi są w `_linkedin-probe/` (w .gitignore, nie commitować); `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` tylko w `.env.local`.
  `npm run linkedin:compare` (`scripts/linkedin-compare-export.ts`, spec 13.6a) porównuje eksport CSV z LinkedIn z lokalną bazą: tylko odczyt, odmawia poza localhostem, wypisuje same liczby.
  `scripts/import-linkedin-export.ts` (na sucho domyślnie, `--apply` wykonuje, powtarzalny) uzupełnia bazę z eksportu CSV albo, z `--api`, ze snapshotów `CONNECTIONS`/`INVITATIONS` z sondy (usuwa powtórzone rekordy, pusty snapshot = błąd); kontakty z obu mają `Source = LINKEDIN_EXPORT` („Eksport z LinkedIn”), osobno od `IMPORT` (arkusze). Zdarzenia zaproszenia dla osób bez zaproszenia dostają `dateUnknown`.

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
