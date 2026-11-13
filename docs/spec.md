# li-crm – specyfikacja

Stan ustaleń na 13 listopada 2026. Dokument powstał w rozmowie z Claude
i jest punktem wyjścia do pracy w Claude Code.

## 1. Cel

Zastąpić trzy arkusze Google bazą danych i interfejsem webowym:

1. **„1000  osób LinkedIn”** – ręcznie prowadzony lejek kontaktów
   (zaproszenie → akceptacja → rozmowa → spotkanie BP → decyzja).
2. **„li-contact-data-store”** – surowe dane zbierane rozszerzeniem
   przeglądarki (Brave) i zapisywane przez n8n.
3. **„li-time”** – ręczny dziennik czasu poświęconego na LinkedIn.

Oczekiwane korzyści: jedna osoba = jeden rekord (bez duplikatów między
zakładkami), historia kontaktu jako oś czasu, statystyki liczone z danych
zamiast arkusza „Summary”, mierzenie czasu przyciskiem start/stop.

## 2. Architektura

```
Rozszerzenie Brave (content*.js)
        │ POST JSON, nagłówek x-api-key
        ▼
n8n: workflow "li-contact-data" (id 6rcnz5Rn72xVrtvP)
        │ dziś: append do arkusza li-contact-data-store
        │ docelowo: zapis do Postgresa (lokalnie na hoście)
        ▼
PostgreSQL (Docker, host n8n) ◄──── Next.js na Vercel (UI + API)
```

- n8n i Postgres to dwa osobne `docker-compose` na tym samym hoście.
  n8n jest wystawione przez Cloudflare (`n8n.dmb24.pl`), Postgres przez
  DDNS `dirwro.ddns.net:54320`.
- W n8n istnieje już credential Postgresa „Postgres account: personal_email”
  (inna baza). Dla li-crm tworzymy osobną bazę i osobnego użytkownika
  oraz nowy credential.

### 2.1 Wymagania bezpieczeństwa bazy produkcyjnej

- SSL włączony w Postgresie (sprawdzić `SHOW ssl;`), klient z `sslmode=require`.
- Osobny użytkownik `li_crm` z uprawnieniami tylko do bazy `li_crm`,
  uwierzytelnianie `scram-sha-256`, silne hasło.
- Vercel nie ma stałych IP, więc nie ograniczamy dostępu po adresie.
- Backup: cron z `pg_dump` na hoście.
- Pooling: na start niski `connection_limit` w `DATABASE_URL`. PgBouncer
  dopiero, gdy zabraknie połączeń.
- Zmiana IP przez DDNS może dawać kilkuminutowe przerwy. Akceptowalne.

### 2.2 Dlaczego nie Supabase (na razie)

Start na własnym Postgresie, bez zależności od funkcji Supabase. Migracja
do Supabase później = dump/restore i zmiana `DATABASE_URL`. Odwrotna droga
(wyjście z Supabase Auth/RLS/Storage) wymagałaby przepisywania aplikacji.

## 3. Rozszerzenie przeglądarki (istniejące)

Chrome/Brave extension „LinkedIn Tools” (MV3). Skrypty wstrzykiwane z popupu,
dane rozpoznawane po strukturze DOM i atrybutach aria, nie po klasach CSS.

| Skrypt | Strona LinkedIn | `source` w payloadzie | Pola wyniku |
|---|---|---|---|
| content.js | profil `/in/` | – | kopiuje e-mail i telefon do schowka |
| content2.js | wyniki wyszukiwania | (search) | name, profileUrl, occupation, … |
| content3.js | Kto oglądał Twój profil | `profile_viewers` | name, profileUrl, occupation, degree, viewedAt |
| content4.js | People you may know | `people_you_may_know` | name, profileUrl, occupation, openToWork? |
| content5.js | Manage invitations – Suggestions | (suggestions) | name, profileUrl, occupation, openToWork? |
| content6.js | profil `/in/` | `profile_page` | name, location, occupation, profileUrl |
| content7.js | More profiles | `more_profiles` | name, profileUrl, occupation, degree |

Format żądania: `{ count, source, results: [ {...}, ... ] }`.
`openToWork` występuje tylko, gdy wykryto ramkę „Open to work” (wartość `"PRAWDA"`).

**Do poprawy:** klucz `x-api-key` jest zapisany na sztywno w każdym
content*.js. Przenieść do ustawień rozszerzenia (chrome.storage) i wygenerować
nowy klucz.

## 4. Workflow n8n

- **li-contact-data** (aktywny): Webhook (header auth) → Code
  (`return $input.first().json.body.results`) → Google Sheets append
  (kolumny: name, location, occupation, contact-from, open-to-work,
  profileUrl, timestamp). Docelowo: zamiana ostatniego węzła na zapis do
  Postgresa albo wywołanie endpointu `/api/ingest` aplikacji (do decyzji, spec 9).
- **LinkedIn Reminder** (LpacBhuN2XuGffIK) i **LinkedIn Re-Connect Reminder**
  (5EPRlG3sxyVHCZDl), oba aktywne z tagiem `linkedin`. Najpewniej czytają
  arkusz. Do przejrzenia i przepięcia na bazę albo zastąpienia widokiem
  „Dziś do zrobienia” w aplikacji.

## 5. Źródła danych i mapowanie

### 5.1 „1000  osób LinkedIn”

Spreadsheet ID: `12fC9gDvcuRAr9CkDTww2TqxMNlQyWWGQWPI_9bSlYWc`.
Wiersze 1–3: podsumowania i liczniki. Wiersz 4: nagłówki. Dane od wiersza 5.
Kolumna A pusta, B = L.p.

**Zakładki do importu** (wspólna struktura kolumn; nazwa zakładki → tag):
Częstochowa, Wrocław, Kraków, Szczecin, Warszawa, Katowice,
Katowice - reconnect, Ja zapraszam, Zaprosili mnie, Wrocław (nauczycielki),
OpenToWork, Oglądali mnie, Kontakty, Viewers.

Kierunek: „Zaprosili mnie” → `INBOUND`, pozostałe → `OUTBOUND`.
Główna zakładka robocza: „Ja zapraszam”.

**Pomijane:** Summary, Kopia arkusza Summary, Make2Google, Arkusz7, Arkusz8,
2025-10-19. Statystyki z „Summary” odtwarzamy w aplikacji z danych.

Kopia „Kopia 1000  osób LinkedIn” (z czerwca 2026) – ignorujemy.

**Mapowanie kolumn** (nagłówki z wiersza 4, zakładka „Ja zapraszam”):

| Kolumna | Znaczenie | Docelowo |
|---|---|---|
| Osoba | imię i nazwisko | `Contact.name` |
| Location | lokalizacja | `Contact.location` |
| Occupation | stanowisko/headline | `Contact.occupation` |
| Contact-From | skąd kontakt | `Contact.contactFrom` |
| OTW | Open to work | `Contact.openToWork` |
| Connect | data wysłania zaproszenia | event `INVITE_SENT.occurredAt` |
| Connect-Msg | treść zaproszenia | event `INVITE_SENT.message` |
| Viewed | osoba oglądała mój profil (czasem ktoś, z kim zacząłem interakcję, czasem nieoczekiwany) | event `VIEWED_MY_PROFILE` |
| Ignored | wyłącznik rekordu: nie wracam do kontaktu (nie chce rozmów albo odrzucił zaproszenie – status przestał być „pending”, znów 2./3. stopień) | `Contact.archived = true`, `archiveReason` |
| Delay | dni od zaproszenia do akceptacji | liczone, nie importujemy |
| Accept | data akceptacji | event `ACCEPTED` |
| Appreciation | data, gdy osoba przy akceptacji dodatkowo zareagowała (emotka, odpowiedź) | event `REACTION_RECEIVED` |
| Appr.-Resp. | data mojej odpowiedzi/podziękowania | event `THANKS_SENT.occurredAt` |
| Appr.-Resp.-Msg | treść mojej odpowiedzi | event `THANKS_SENT.message` |
| Are-You-Open | data pytania, czy osoba jest otwarta na rozmowę | event `ASKED_OPEN` |
| A-Y-O-Text | treść pytania | event `ASKED_OPEN.message` |
| A-Y-O-Reminder | data przypomnienia | event `ASKED_OPEN_REMINDER` |
| A-Y-O-Reminder-Text | treść przypomnienia | event `ASKED_OPEN_REMINDER.message` |
| A-Y-O-Response | **do potwierdzenia** (spec 9) | event `ASKED_OPEN_RESPONSE` |
| A-Y-O-Decision | data odpowiedzi na pytanie A-Y-O | `occurredAt` zdarzenia wyniku |
| Open-To-Talk | wynik: chce rozmawiać | event `OPEN_TO_TALK` |
| NO | wynik: nie chce | event `NOT_INTERESTED` |
| NO-Response-Text | moja odpowiedź na odmowę | `NOT_INTERESTED.message` |
| Meet-Proposal | data propozycji spotkania | event `MEETING_PROPOSED` |
| Meet-Proposal-Text | treść | `.message` |
| Meet-Proposal-Reminder | data przypomnienia | event `MEETING_PROPOSAL_REMINDER` |
| Meet-Proposal-Reminder-Text | treść | `.message` |
| BP-Date | termin spotkania BP | event `BP_SCHEDULED.scheduledAt` |
| Confirmed | potwierdzone | event `BP_CONFIRMED` |
| BP-Canceled | odwołane | event `BP_CANCELED` |
| BP-NoShow | nieobecność | event `BP_NO_SHOW` |
| BP-Completed | odbyte | event `BP_COMPLETED` |
| Decision-YES | decyzja na tak | event `DECISION_YES` |
| Decision-NO | decyzja na nie | event `DECISION_NO` |
| Info | notatki | `Contact.info` |
| email | e-mail | `Contact.email` |
| phone | telefon | `Contact.phone` |
| profileUrl | URL profilu | `Contact.profileUrl` (znormalizowany) |
| onViewersList | był na liście oglądających | event `VIEWED_MY_PROFILE` (jeśli brak daty: data importu) |

Uwagi do importu:
- Pola logiczne mają wartości `TRUE`/`FALSE` (czasem `PRAWDA`). Pola etapów
  mogą zawierać datę (`YYYY-MM-DD`) albo `TRUE`. Gdy jest tylko `TRUE`, bez daty,
  użyć najbliższej wcześniejszej znanej daty z wiersza i oznaczyć to w raporcie.
- Zakładki poza „Ja zapraszam” mogą mieć 1–3 kolumny mniej lub więcej
  (34–44 kolumn) – mapować po nazwie nagłówka z wiersza 4, nigdy po pozycji.
- `salutation` (wołacz) można wyciągnąć z `Connect-Msg`
  („Dzień dobry, Pani Aniu 🙂 …” → „Pani Aniu”).

### 5.2 „li-contact-data-store”

Spreadsheet ID: `1BPliOyz2dn_NLj7ozRmtUUbprObKOy7_zaPqYMomC2E`, zakładka
Arkusz1. Kolumny: name, location, occupation, contact-from, open-to-work,
profileUrl, timestamp. Każdy wiersz → `Capture` + upsert `Contact`
(nie nadpisujemy niepustych pól danymi pustymi).

### 5.3 „li-time”

Spreadsheet ID: `1NGPnInO_Q_yoifYPgTa28_92s61tXl1Xa67AitQK4fc`.
Zakładki „od 2026-06-17” i „od 2026-07-16”. Kolumny A–D: start, end,
duration, comments. Kolumny od F to podsumowania z formuł – pomijamy.
Wpisy były wprowadzane ręcznie.

`comments` ma postać „typ czynności (liczba)”, np. „akceptacja (3)”,
„zaproszenia do kontaktu (31)”, „wiadomość (2)”, „oglądacze”.
Import: regex `^(.*?)\s*(?:\((\d+)\))?$` → `ActivityType.name` + `TimeEntry.count`.
Strefa czasowa: Europe/Warsaw.

## 6. Reguły domenowe

### 6.1 Normalizacja `profileUrl`

1. Usuń query string i fragment.
2. Usuń końcowy `/`.
3. Zdekoduj znaki procentowe (`ma%C5%82gorzata` → `małgorzata`).
4. Ujednolić host do `https://www.linkedin.com`, ścieżka `/in/<slug>`.
5. Slug małymi literami.

Duplikaty po normalizacji: scalamy w jeden kontakt, zdarzenia łączymy,
konflikty wartości pól zapisujemy do raportu importu do ręcznej decyzji.

### 6.2 Etap (`Contact.stage`)

Wyliczany z najpóźniejszego zdarzenia lejka wg kolejności z enum `Stage`.
Zdarzenia `NOTE` i `VIEWED_MY_PROFILE` nie zmieniają etapu.
`archived` jest niezależne od etapu.

## 7. Funkcje aplikacji (MVP)

1. Lista kontaktów: filtry po etapie, kierunku, tagu, OTW, zarchiwizowanych;
   wyszukiwanie po imieniu i URL.
2. Karta kontaktu: dane, oś czasu zdarzeń, przyciski następnego kroku
   (np. „Zaproszenie zaakceptowane”, „Wyślij podziękowanie”) z datą
   domyślnie dziś, archiwizacja z powodem.
3. „Dziś do zrobienia”: kontakty czekające na kolejny krok lub przypomnienie.
   Progi dni do ustalenia na podstawie workflowów reminderów z n8n.
4. Statystyki (zastępuje „Summary”): konwersje między etapami, czas reakcji,
   liczby w okresach.
5. Czas pracy: start/stop z wyborem czynności i liczbą sztuk, edycja wpisów,
   podsumowania dzienne/miesięczne, czas na sztukę danego typu.
6. Endpoint `POST /api/ingest` (klucz w nagłówku) przyjmujący format
   rozszerzenia – na wypadek, gdyby n8n miało wołać aplikację zamiast bazy.

Później: szablony wiadomości z podstawianiem `salutation`, eksport CSV,
przepięcie rozszerzenia bezpośrednio na aplikację.

## 8. Plan prac

1. Repozytorium Next.js + Prisma + Docker Compose z Postgresem do dev.
2. Migracja początkowa ze schematu z `prisma/schema.prisma`.
3. Skrypt importu (`scripts/import-sheets.ts`): odczyt z Google Sheets API
   (albo z eksportu CSV), normalizacja, scalanie, raport duplikatów
   i konfliktów. Najpierw tryb „dry run”.
4. UI: lista → karta kontaktu → czas pracy → statystyki → „dziś do zrobienia”.
5. Prod: baza `li_crm` na serwerze, SSL, użytkownik, backup; deploy na Vercel.
6. n8n: przepięcie li-contact-data na bazę; przegląd reminderów.
7. Rozszerzenie: klucz API do ustawień.

## 9. Otwarte pytania

- **A-Y-O-Response** – co dokładnie oznacza ta kolumna wobec A-Y-O-Decision
  (data odpowiedzi)? Np. „osoba w ogóle odpowiedziała”?
- n8n: zapis bezpośrednio do Postgresa czy przez `/api/ingest` aplikacji?
- Jakie reguły czasowe stosują workflowy LinkedIn Reminder / Re-Connect Reminder?
- Czy „Kontakty” i „Viewers” to zwykłe segmenty, czy mają inną semantykę
  (Viewers ma 4108 wierszy i nie ma zamrożonych kolumn)?
- SSL na istniejącym Postgresie: włączony?
