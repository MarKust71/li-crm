---
paths:
  - "lib/bom-draft*.ts"
  - "lib/signature-photo.ts"
  - "lib/contact-events.ts"
  - "lib/calendar-sync.ts"
  - "lib/settings.ts"
  - "app/settings/**"
  - "app/contacts/**"
---

# Szkic e-maila po umówieniu BOM

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
