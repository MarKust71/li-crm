// Pobiera wszystkie wydarzenia z kalendarza Google "dMb" (tylko odczyt) do lokalnego JSON-a.
// Użycie: GOOGLE_SA_KEY_FILE=./secrets/sa.json npx tsx scripts/snapshot-calendar.ts
// Wynik: data/snapshots/calendar/dMb.json  (katalog data/ jest w .gitignore: zawiera dane osobowe)
//
// Wymaga: (1) włączonego Google Calendar API w projekcie konta serwisowego,
//         (2) udostępnienia kalendarza kontu serwisowemu ("Wyświetlanie wszystkich szczegółów wydarzeń").
import { google } from "googleapis";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const CALENDAR_ID = "ibaah6jp13k0pjcc8nge6ahvmc@group.calendar.google.com"; // kalendarz "dMb"

async function main() {
  const keyFile = process.env.GOOGLE_SA_KEY_FILE;
  if (!keyFile) throw new Error("Ustaw GOOGLE_SA_KEY_FILE (ścieżka do klucza konta serwisowego).");

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  const calendar = google.calendar({ version: "v3", auth });

  const events: unknown[] = [];
  let pageToken: string | undefined;
  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      singleEvents: true, // rozwiń ewentualne wydarzenia cykliczne
      showDeleted: false,
      orderBy: "startTime",
      maxResults: 2500,
      pageToken,
    });
    for (const e of res.data.items ?? []) {
      events.push({
        id: e.id,
        status: e.status,
        summary: e.summary ?? null,
        description: e.description ?? null,
        start: e.start,
        end: e.end,
        created: e.created,
        updated: e.updated,
        recurringEventId: e.recurringEventId ?? null,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  const dir = path.join("data", "snapshots", "calendar");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "dMb.json"),
    JSON.stringify({ calendarId: CALENDAR_ID, fetchedAt: new Date().toISOString(), events }),
  );
  console.log(`Pobrano ${events.length} wydarzeń z kalendarza dMb.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
