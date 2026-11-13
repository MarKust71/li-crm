# li-crm

Prywatny CRM do pracy z kontaktami z LinkedIn. Zastępuje trzy arkusze Google
(lejek kontaktów, dane z rozszerzenia przeglądarki, dziennik czasu pracy).
Jeden użytkownik: właściciel projektu.

Pełna specyfikacja, mapowanie kolumn arkuszy i otwarte pytania: `docs/spec.md`.
Schemat bazy: `prisma/schema.prisma`.

## Stack

- Next.js (App Router, TypeScript) na Vercel, funkcje w regionie `fra1`
- PostgreSQL na własnym serwerze (Docker), dostęp przez Prisma
- Logowanie: Auth.js, jeden użytkownik
- n8n (`n8n.dmb24.pl`) przyjmuje webhook z rozszerzenia i zapisuje do bazy

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
- UI i komunikaty po polsku, identyfikatory w kodzie po angielsku.
- Arkusze Google są tylko źródłem importu. Nie zapisujemy do nich.

## Środowiska

- Dev: Postgres w lokalnym Dockerze (`docker compose up -d db`).
- Prod: istniejący kontener Postgresa na hoście n8n, osobna baza `li_crm`
  i osobny użytkownik, połączenie z Vercela przez `dirwro.ddns.net:54320`
  z wymuszonym SSL (`sslmode=require`) i niskim `connection_limit`.

## Zmienne środowiskowe

- `DATABASE_URL`, `DIRECT_URL`
- `AUTH_SECRET`, dane logowania jedynego użytkownika
- `INGEST_API_KEY` – klucz dla endpointu przyjmującego dane z n8n/rozszerzenia
