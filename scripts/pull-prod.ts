/**
 * Kopiuje produkcję do lokalnej bazy (dev): zrzut `pg_dump` produkcji (tylko odczyt) i przywrócenie do kontenera `li-crm-db`.
 *
 *   npm run db:pull-prod          # kopia lokalnej bazy → zrzut prod → nadpisanie lokalnej
 *   npm run db:pull-prod -- --yes # bez pytania o potwierdzenie
 *
 * Adres produkcji: `BACKUP_DATABASE_URL` albo `DIRECT_URL` z `.env.production.local`. Lokalny: `DATABASE_URL` z `.env`
 * (musi wskazywać localhost, inaczej skrypt odmawia). Lokalna baza jest NADPISYWANA (schemat `public`), ale przed tym
 * powstaje jej kopia w `_backups/`. Zrzuty zawierają dane osobowe i nie są szyfrowane (folder w .gitignore).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const CONTAINER = "li-crm-db";
const ROOT = process.cwd();

function sh(cmd: string, args: string[], env: Record<string, string> = {}, inherit = false) {
  const res = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: inherit ? "inherit" : "pipe" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} nie powiódł się:\n${res.stderr || res.error || ""}`);
  return res.stdout ?? "";
}

function readEnvFile(file: string, key: string): string | undefined {
  const path = join(ROOT, file);
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

function latestBackup(label: string): string {
  const dir = join(ROOT, "_backups");
  const files = readdirSync(dir).filter((f) => f.startsWith(`li-crm-backup-${label}-`) && f.endsWith(".sql")).sort();
  const last = files.at(-1);
  if (!last) throw new Error(`Brak zrzutu ${label} w _backups/`);
  return join(dir, last);
}

async function main() {
  const local = process.env.DATABASE_URL ?? readEnvFile(".env", "DATABASE_URL");
  const prod = process.env.BACKUP_DATABASE_URL ?? readEnvFile(".env.production.local", "DIRECT_URL");
  if (!local) throw new Error("Brak DATABASE_URL (.env).");
  if (!prod) throw new Error("Brak adresu produkcji (BACKUP_DATABASE_URL albo DIRECT_URL w .env.production.local).");

  const lu = new URL(local);
  const pu = new URL(prod);
  if (!["localhost", "127.0.0.1"].includes(lu.hostname)) throw new Error(`DATABASE_URL wskazuje ${lu.host}, nie localhost. Odmawiam nadpisania.`);
  if (["localhost", "127.0.0.1"].includes(pu.hostname)) throw new Error("Adres produkcji wskazuje localhost. Sprawdź .env.production.local.");
  const db = lu.pathname.slice(1);
  const user = decodeURIComponent(lu.username);

  console.log(`Źródło (tylko odczyt): ${pu.host}\nCel (NADPISANIE):      ${lu.host}/${db}`);
  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question("Nadpisać lokalną bazę zawartością produkcji? (tak/nie) ")).trim().toLowerCase();
    rl.close();
    if (ans !== "tak") throw new Error("Przerwano.");
  }

  console.log("1/3 Kopia lokalnej bazy…");
  sh("npx", ["tsx", "--env-file=.env", "scripts/backup-db.ts"], { BACKUP_DATABASE_URL: "" }, true);

  console.log("2/3 Zrzut produkcji…");
  sh("npx", ["tsx", "--env-file=.env", "scripts/backup-db.ts"], { BACKUP_DATABASE_URL: prod }, true);
  const dump = latestBackup(pu.hostname.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase());

  console.log("3/3 Przywracanie do lokalnej bazy…");
  const clean = readFileSync(dump, "utf8").split("\n").filter((l) => !/prisma_postgres/i.test(l)).join("\n");
  const tmp = join(ROOT, "_backups", ".restore-tmp.sql");
  writeFileSync(tmp, clean, { mode: 0o600 });
  try {
    sh("docker", ["cp", tmp, `${CONTAINER}:/tmp/restore.sql`]);
    const psql = (extra: string[]) => sh("docker", ["exec", CONTAINER, "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-q", ...extra]);
    psql(["-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"]);
    psql(["-f", "/tmp/restore.sql"]);
  } finally {
    unlinkSync(tmp);
    spawnSync("docker", ["exec", CONTAINER, "rm", "-f", "/tmp/restore.sql"]);
  }

  const counts = sh("docker", ["exec", CONTAINER, "psql", "-U", user, "-d", db, "-tAc", 'select count(*) from "Contact"']).trim();
  console.log(`OK: lokalna baza = produkcja (kontaktów: ${counts}). Zrzut: ${dump}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
