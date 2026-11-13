// Pobiera surowe dane z arkuszy Google do lokalnych plików JSON (tylko odczyt).
// Użycie: GOOGLE_SA_KEY_FILE=./secrets/sa.json npx tsx scripts/snapshot-sheets.ts
// Wynik: data/snapshots/<spreadsheet>/<zakładka>.json  (katalog data/ jest w .gitignore)
import { google } from "googleapis";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SPREADSHEETS = {
  "1000-osob": "12fC9gDvcuRAr9CkDTww2TqxMNlQyWWGQWPI_9bSlYWc",
  "li-contact-data-store": "1BPliOyz2dn_NLj7ozRmtUUbprObKOy7_zaPqYMomC2E",
  "li-time": "1NGPnInO_Q_yoifYPgTa28_92s61tXl1Xa67AitQK4fc",
} as const;

// Zakładki pomijane (spec 5.1). Dla pozostałych arkuszy pobieramy wszystko.
const SKIP = new Set([
  "Summary",
  "Kopia arkusza Summary",
  "Make2Google",
  "Arkusz7",
  "Arkusz8",
  "2025-10-19",
]);

async function main() {
  const keyFile = process.env.GOOGLE_SA_KEY_FILE;
  if (!keyFile) throw new Error("Ustaw GOOGLE_SA_KEY_FILE (ścieżka do klucza konta serwisowego).");

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  for (const [name, id] of Object.entries(SPREADSHEETS)) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: id,
      fields: "properties.timeZone,sheets.properties.title",
    });
    const timeZone = meta.data.properties?.timeZone ?? null;
    const dir = path.join("data", "snapshots", name);
    mkdirSync(dir, { recursive: true });

    for (const s of meta.data.sheets ?? []) {
      const title = s.properties?.title;
      if (!title || (name === "1000-osob" && SKIP.has(title))) continue;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `'${title.replace(/'/g, "''")}'`,
        valueRenderOption: "UNFORMATTED_VALUE", // surowe liczby i boolean
        dateTimeRenderOption: "SERIAL_NUMBER", // daty jako numery seryjne (epoka 1899-12-30)
      });
      const file = path.join(dir, `${title.replace(/[\\/]/g, "_")}.json`);
      writeFileSync(
        file,
        JSON.stringify({ spreadsheet: name, sheet: title, timeZone, fetchedAt: new Date().toISOString(), values: res.data.values ?? [] }),
      );
      console.log(`${name} / ${title}: ${(res.data.values ?? []).length} wierszy`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
