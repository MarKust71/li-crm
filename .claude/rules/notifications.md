---
paths:
  - "lib/notify*.ts"
  - "lib/report*.ts"
  - "app/api/notify/**"
  - "app/settings/**"
---

# Powiadomienia i raport e-mail

- Powiadomienia Telegram: aplikacja układa treść i decyduje, co wysłać (`lib/notify-core.ts`, `lib/notify.ts`, endpointy
  `/api/notify/pending` i `/result`, ten sam `SYNC_API_KEY`); n8n (workflow "li-crm: powiadomienia Telegram", co minutę) tylko wysyła
  i potwierdza. Wiadomość liczy się jako wysłana dopiero po potwierdzeniu (`SentNotification`). Ustawienia w "Ustawienia".

- Raport dzienny e-mailem (`lib/report-core.ts` treść i termin, `lib/report.ts` zapytania): jeden mail za poprzedni dzień kalendarzowy
  (czas warszawski), od ustawionej godziny (domyślnie 00:00), także gdy nic się nie działo. Adres i godzina w „Ustawienia” (`report.*` w `AppSetting`;
  bez adresu nic nie wychodzi; adresu nie wpisywać do repozytorium ani dziennika). Idzie tym samym `/api/notify/pending` co Telegram: wiadomość z
  `channel: "email"` (`to`, `subject`, `html`, `text`), n8n wysyła ją przez SMTP (poświadczenie "SMTP account mitax.pl", nadawca no-reply@mitax.pl);
  bez `channel` = Telegram. Klucze `report:<dzień>` i `reporttest:<ts>`. Aplikacja nie ma haseł SMTP.
  Definicje (osoby, nie zdarzenia; `dateUnknown` pomijane w liczbach z datą): zaproszenia i przyjęcia jak na dashboardzie (OUTBOUND z `INVITE_SENT`;
  „z tego już przyjęte” = przyjęcie tego samego dnia), podziękowania i pytania o otwartość ze wszystkich kontaktów; cel: pytań ≥ podziękowań
  (dzień i bilans 7 dni). Zaległości = niezarchiwizowane kontakty z etapem `THANKED` (czekają na pytanie; okna 3/7/30 dni wg daty podziękowania)
  i `ACCEPTED` (czekają na podziękowanie; 7/30 dni wg daty przyjęcia), „razem” obejmuje też te bez znanej daty; liczone wg stanu w chwili wysyłki.
