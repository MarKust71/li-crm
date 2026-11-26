---
paths:
  - "scripts/*linkedin*.ts"
---

# LinkedIn: API i eksport danych

- Badanie LinkedIn Member Data Portability API (3rd Party): `scripts/linkedin-probe.ts` (`npm run linkedin:probe`, spec 13.6), tylko sonda, nic nie trafia do bazy.
  Wyniki z prawdziwymi danymi osobowymi są w `_linkedin-probe/` (w .gitignore, nie commitować); `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` tylko w `.env.local`.
  `npm run linkedin:compare` (`scripts/linkedin-compare-export.ts`, spec 13.6a) porównuje eksport CSV z LinkedIn z lokalną bazą: tylko odczyt, odmawia poza localhostem, wypisuje same liczby.
  `scripts/import-linkedin-export.ts` (na sucho domyślnie, `--apply` wykonuje, powtarzalny) uzupełnia bazę z eksportu CSV albo, z `--api`, ze snapshotów `CONNECTIONS`/`INVITATIONS` z sondy (usuwa powtórzone rekordy, pusty snapshot = błąd); kontakty z obu mają `Source = LINKEDIN_EXPORT` („Eksport z LinkedIn”), osobno od `IMPORT` (arkusze). Zdarzenia zaproszenia dla osób bez zaproszenia dostają `dateUnknown`.
