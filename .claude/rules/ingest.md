---
paths:
  - "lib/ingest*.ts"
  - "lib/candidates.ts"
  - "lib/contacts*.ts"
  - "lib/profile-url.ts"
  - "app/api/ingest/**"
  - "app/inbox/**"
  - "app/contacts/**"
---

# Dane z rozszerzenia i poczekalnia

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
