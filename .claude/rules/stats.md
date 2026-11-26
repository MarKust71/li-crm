---
paths:
  - "lib/stats*.ts"
  - "app/stats/**"
  - "app/dashboard/**"
---

# Statystyki i dashboard

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
