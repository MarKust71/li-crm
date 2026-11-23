# li-crm

Prywatny CRM do kontaktów z LinkedIn. Specyfikacja: `docs/spec.md`, zasady: `CLAUDE.md`.

## Dev

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres w Dockerze, port 5433
npm run db:migrate   # prisma migrate dev
npm run db:pull-prod # nadpisuje lokalną bazę kopią produkcji (najpierw kopia lokalnej)
npm run dev
```
