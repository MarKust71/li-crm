/**
 * Kopia zapasowa bazy: `pg_dump` uruchamiany w kontenerze `li-crm-db` (postgres:17; lokalnie nie ma `pg_dump`).
 * Zapis do `_backups/li-crm-backup-<data>-<godzina>.sql` (folder w .gitignore, plik `chmod 600`: są dane osobowe,
 * plik NIE jest szyfrowany). Starsze kopie ponad limit są usuwane (domyślnie zostaje 8 najnowszych).
 *
 *   npm run backup                                  # baza z DATABASE_URL (zwykle dev)
 *   BACKUP_DATABASE_URL='postgres://…' npm run backup   # np. produkcja (DIRECT_URL z Prisma Postgres)
 *   npm run backup -- --keep 12                     # inny limit kopii
 *
 * Hasło trafia do kontenera zmienną środowiskową, nie argumentem polecenia. Adres z hostem localhost/127.0.0.1
 * (dev, port 5433) jest przepisany na localhost:5432, bo `pg_dump` działa wewnątrz kontenera.
 * Odtwarzanie na zwykły Postgres: `psql "$URL" -f plik.sql` (przy imporcie poza Prismę usuń linię `CREATE EXTENSION prisma_postgres`).
 * Kontener `li-crm-db` musi działać (`npm run db:up`), także przy zrzucie produkcji.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const CONTAINER = "li-crm-db";
const DIR = join(process.cwd(), "_backups");
const PREFIX = "li-crm-backup-";

function run(args: string[], opts: { env?: Record<string, string> } = {}) {
  const res = spawnSync("docker", args, { encoding: "utf8", env: { ...process.env, ...opts.env } });
  if (res.status !== 0) throw new Error(`docker ${args[0]} ${args[1] ?? ""} nie powiódł się:\n${res.stderr || res.error}`);
  return res.stdout;
}

function main() {
  const keepIdx = process.argv.indexOf("--keep");
  const keep = keepIdx > -1 ? Number(process.argv[keepIdx + 1]) : 8;
  if (!Number.isInteger(keep) || keep < 1) throw new Error("--keep musi być liczbą całkowitą >= 1");

  const raw = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error("Brak BACKUP_DATABASE_URL i DATABASE_URL (uruchom z --env-file=.env lub podaj adres).");
  const url = new URL(raw);
  const host = url.host;
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (local) url.host = "localhost:5432";
  url.searchParams.delete("schema"); // pg_dump nie zna parametru Prismy
  console.log(`Baza: ${host} · katalog: ${DIR}`);

  const running = run(["ps", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"]).trim();
  if (running !== CONTAINER) throw new Error(`Kontener ${CONTAINER} nie działa (npm run db:up).`);

  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const file = join(DIR, `${PREFIX}${stamp}.sql`);
  const tmp = `/tmp/${PREFIX}${stamp}.sql`;

  try {
    run(["exec", "-e", "BACKUP_URL", CONTAINER, "sh", "-c", `pg_dump "$BACKUP_URL" --no-owner --no-privileges -f ${tmp}`], {
      env: { BACKUP_URL: url.toString() },
    });
    run(["cp", `${CONTAINER}:${tmp}`, file]);
  } finally {
    spawnSync("docker", ["exec", CONTAINER, "rm", "-f", tmp]);
  }
  chmodSync(file, 0o600);

  const size = statSync(file).size;
  const tables = (readFileTables(file)).length;
  if (size < 1024 || tables === 0) throw new Error(`Podejrzanie mała kopia (${size} B, ${tables} tabel): ${file}`);
  console.log(`OK: ${file} (${(size / 1024 / 1024).toFixed(1)} MB, ${tables} tabel)`);

  const old = readdirSync(DIR)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".sql"))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) {
    unlinkSync(join(DIR, f));
    console.log(`Usunięto starą kopię: ${f}`);
  }
}

function readFileTables(file: string): string[] {
  const res = spawnSync("grep", ["-c", "^CREATE TABLE ", file], { encoding: "utf8" });
  return Array.from({ length: Number(res.stdout.trim()) || 0 });
}

if (!existsSync(join(process.cwd(), "package.json"))) throw new Error("Uruchom z katalogu głównego projektu.");
try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
