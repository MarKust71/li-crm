/**
 * Sonda LinkedIn Member Data Portability API (3rd Party): sprawdza, jakie dane są dostępne wprost z LinkedIn.
 * Jednorazowe narzędzie badawcze, niczego nie zapisuje do bazy.
 *
 *   npm run linkedin:probe -- auth                    # OAuth (przeglądarka), zapis tokenu
 *   npm run linkedin:probe -- snapshot                # domeny domyślne (kontakty, zaproszenia, wiadomości, profil...)
 *   npm run linkedin:probe -- snapshot CONNECTIONS INBOX
 *   npm run linkedin:probe -- snapshot --all          # wszystkie domeny naraz (bez parametru domain)
 *   npm run linkedin:probe -- changelog               # zdarzenia z ostatnich 28 dni
 *   npm run linkedin:probe -- changelog --enable      # najpierw włącz generowanie changelogu (POST memberAuthorizations)
 *   npm run linkedin:probe -- summary                 # nazwy pól i liczności z zapisanych plików
 *   npm run linkedin:probe -- history                 # dziennik prób (attempts.jsonl): data, rodzaj, status, liczby
 *
 * Zmienne (z .env.local): LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET; opcjonalnie LINKEDIN_REDIRECT_URI
 * (domyślnie http://localhost:3113/callback, musi być wpisany dokładnie tak w Developer Portal),
 * LINKEDIN_CHANGELOG_VERSION (domyślnie 202312).
 *
 * Dane osobowe: wyniki lądują w `_linkedin-probe/` (folder w .gitignore, pliki 0600). Na terminal trafiają tylko
 * nazwy pól i liczby, nigdy wartości ani tokeny. Źródło: learn.microsoft.com/en-us/linkedin/dma/member-data-portability
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const OUT = join(process.cwd(), "_linkedin-probe");
const TOKEN_FILE = join(OUT, "token.json");
const API = "https://api.linkedin.com";
const SNAPSHOT_VERSION = "202312"; // endpoint obsługuje tylko tę wersję
const CHANGELOG_VERSION = process.env.LINKEDIN_CHANGELOG_VERSION ?? "202312";
const SCOPE = "r_dma_portability_3rd_party";
const REDIRECT = process.env.LINKEDIN_REDIRECT_URI ?? "http://localhost:3113/callback";

const DEFAULT_DOMAINS = [
  "CONNECTIONS",
  "INVITATIONS",
  "INBOX",
  "CONTACTS",
  "PROFILE",
  "POSITIONS",
  "EMAIL_ADDRESSES",
  "PHONE_NUMBERS",
  "MEMBER_FOLLOWING",
  "SEARCHES",
  "ALL_COMMENTS",
  "ALL_LIKES",
];

type Token = { access_token: string; expires_at: number; refresh_token_present: boolean; scope?: string };

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Brak ${name} (uruchom przez npm run linkedin:probe, który wczytuje .env.local).`);
  return v;
}

function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** Dziennik prób (JSONL): data, rodzaj, status HTTP, liczby. Bez danych osobowych i tokenów. */
const ATTEMPTS_FILE = join(OUT, "attempts.jsonl");
function logAttempt(entry: Record<string, unknown>) {
  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  appendFileSync(ATTEMPTS_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", { mode: 0o600 });
}

function loadToken(): Token {
  if (!existsSync(TOKEN_FILE)) throw new Error("Brak tokenu. Najpierw: npm run linkedin:probe -- auth");
  const t = JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as Token;
  if (Date.now() > t.expires_at) throw new Error("Token wygasł (60 dni). Powtórz: npm run linkedin:probe -- auth");
  return t;
}

// ---------- OAuth ----------

async function auth() {
  const clientId = need("LINKEDIN_CLIENT_ID");
  const clientSecret = need("LINKEDIN_CLIENT_SECRET");
  const state = randomBytes(16).toString("hex");
  const redirect = new URL(REDIRECT);

  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    state,
    scope: SCOPE,
  }).toString();

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", REDIRECT);
      if (u.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get("error");
      const got = u.searchParams.get("code");
      const ok = !err && got && u.searchParams.get("state") === state;
      res.writeHead(ok ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
      res.end(ok ? "Gotowe, możesz zamknąć kartę." : `Błąd autoryzacji: ${err ?? "zły state / brak code"}`);
      server.close();
      if (ok) resolve(got);
      else reject(new Error(`Autoryzacja odrzucona: ${err ?? "zły state / brak code"} ${u.searchParams.get("error_description") ?? ""}`));
    });
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      console.log("Otwieram przeglądarkę. Jeśli się nie otworzy, wejdź na ten adres:\n" + authUrl.toString() + "\n");
      spawnSync("open", [authUrl.toString()]);
    });
    setTimeout(() => {
      server.close();
      reject(new Error("Przekroczono czas oczekiwania (5 min)."));
    }, 5 * 60_000).unref();
  });

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") {
    throw new Error(`Wymiana kodu nie powiodła się (${res.status}): ${String(body.error ?? "")} ${String(body.error_description ?? "")}`);
  }
  const token: Token = {
    access_token: body.access_token,
    expires_at: Date.now() + Number(body.expires_in ?? 0) * 1000,
    refresh_token_present: typeof body.refresh_token === "string",
    scope: typeof body.scope === "string" ? body.scope : undefined,
  };
  save("token.json", token);
  console.log(`Token zapisany (ważny do ${new Date(token.expires_at).toISOString().slice(0, 10)}, scope: ${token.scope ?? "?"}).`);
}

// ---------- API ----------

async function get(url: string, token: Token, version: string) {
  const full = url.startsWith("http") ? url : `${API}${url}`;
  const res = await fetch(full, {
    headers: { authorization: `Bearer ${token.access_token}`, "linkedin-version": version, "content-type": "application/json" },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* zostaje tekst */
  }
  return { status: res.status, ok: res.ok, body: body as Record<string, any> };
}

type Element = { snapshotDomain: string; snapshotData: Record<string, unknown>[] };

async function fetchSnapshot(token: Token, domain?: string): Promise<Element[]> {
  let url = `/rest/memberSnapshotData?q=criteria${domain ? `&domain=${domain}` : ""}`;
  const all: Element[] = [];
  for (let page = 0; page < 500; page++) {
    const r = await get(url, token, SNAPSHOT_VERSION);
    if (!r.ok) {
      const msg = String(r.body?.message ?? "");
      if (page > 0 && /no data found/i.test(msg)) break; // koniec stron
      console.log(`  ${domain ?? "ALL"}: HTTP ${r.status} ${msg.slice(0, 200)}`);
      logAttempt({ kind: "snapshot", domain: domain ?? "ALL", page, status: r.status, message: msg.slice(0, 200), elements: all.length });
      return all;
    }
    const els = (r.body.elements ?? []) as Element[];
    all.push(...els);
    const next = (r.body.paging?.links ?? []).find((l: { rel?: string }) => l.rel === "next")?.href as string | undefined;
    if (!next || els.length === 0) break;
    url = next;
  }
  logAttempt({ kind: "snapshot", domain: domain ?? "ALL", status: 200, elements: all.length, rows: all.reduce((n, e) => n + (e.snapshotData?.length ?? 0), 0) });
  return all;
}

async function snapshot(args: string[]) {
  const token = loadToken();
  const all = args.includes("--all");
  const domains = args.filter((a) => !a.startsWith("--"));
  if (all) {
    const els = await fetchSnapshot(token);
    const byDomain = new Map<string, Record<string, unknown>[]>();
    for (const e of els) byDomain.set(e.snapshotDomain, [...(byDomain.get(e.snapshotDomain) ?? []), ...(e.snapshotData ?? [])]);
    for (const [d, rows] of byDomain) {
      save(`snapshot-${d}.json`, rows);
      console.log(`  ${d}: ${rows.length}`);
    }
  } else {
    for (const d of domains.length ? domains : DEFAULT_DOMAINS) {
      const els = await fetchSnapshot(token, d);
      const rows = els.flatMap((e) => e.snapshotData ?? []);
      save(`snapshot-${d}.json`, rows);
      console.log(`  ${d}: ${rows.length}`);
    }
  }
  console.log(`\nZapisano w ${OUT}. Podsumowanie pól: npm run linkedin:probe -- summary`);
}

async function changelog(args: string[]) {
  const token = loadToken();
  if (args.includes("--enable")) {
    const res = await fetch(`${API}/rest/memberAuthorizations`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "linkedin-version": CHANGELOG_VERSION, "content-type": "application/json" },
      body: "{}",
    });
    console.log(`Włączenie changelogu: HTTP ${res.status}`);
    logAttempt({ kind: "changelog-enable", status: res.status });
  }
  const auth = await get("/rest/memberAuthorizations?q=memberAndApplication", token, CHANGELOG_VERSION);
  logAttempt({ kind: "changelog-authorization", status: auth.status, fields: Object.keys(auth.body ?? {}) });
  console.log(`Stan autoryzacji changelogu: HTTP ${auth.status}, pola: ${Object.keys(auth.body ?? {}).join(", ")}`);

  const COUNT = 50;
  let startTime: number | undefined;
  const events: Record<string, any>[] = [];
  for (let page = 0; page < 200; page++) {
    const r = await get(
      `/rest/memberChangeLogs?q=memberAndApplication&count=${COUNT}${startTime ? `&startTime=${startTime}` : ""}`,
      token,
      CHANGELOG_VERSION,
    );
    if (!r.ok) {
      console.log(`  changelog: HTTP ${r.status} ${String(r.body?.message ?? "").slice(0, 200)}`);
      logAttempt({ kind: "changelog", page, status: r.status, message: String(r.body?.message ?? "").slice(0, 200), events: events.length });
      break;
    }
    const els = (Array.isArray(r.body) ? r.body : (r.body.elements ?? [])) as Record<string, any>[];
    events.push(...els);
    const last = Math.max(0, ...els.map((e) => Number(e.processedAt ?? 0)));
    if (els.length < COUNT || !last || last === startTime) break;
    startTime = last;
  }
  save("changelog.json", events);
  const counts = new Map<string, number>();
  for (const e of events) {
    const k = `${e.resourceName ?? "?"} / ${e.method ?? "?"}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  logAttempt({ kind: "changelog", status: 200, events: events.length, byResource: Object.fromEntries(counts) });
  console.log(`  Zdarzeń: ${events.length}`);
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${k}`);
}

// ---------- podsumowanie (tylko nazwy pól, bez wartości) ----------

function summary() {
  if (!existsSync(OUT)) throw new Error("Brak danych. Najpierw snapshot / changelog.");
  for (const f of readdirSync(OUT).filter((f) => f.endsWith(".json") && f !== "token.json").sort()) {
    const rows = JSON.parse(readFileSync(join(OUT, f), "utf8")) as Record<string, unknown>[];
    const keys = new Set<string>();
    for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) keys.add(k);
    console.log(`${f.replace(/\.json$/, "")}: ${rows.length} rekordów`);
    if (keys.size) console.log(`  pola: ${[...keys].join(" | ")}`);
  }
}

function history() {
  if (!existsSync(ATTEMPTS_FILE)) {
    console.log("Brak prób w dzienniku.");
    return;
  }
  for (const line of readFileSync(ATTEMPTS_FILE, "utf8").split("\n").filter(Boolean)) {
    const { at, kind, ...rest } = JSON.parse(line) as Record<string, unknown>;
    console.log(`${String(at).slice(0, 19).replace("T", " ")}  ${kind}  ${JSON.stringify(rest)}`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "history") return history();
  if (cmd === "auth") return auth();
  if (cmd === "snapshot") return snapshot(rest);
  if (cmd === "changelog") return changelog(rest);
  if (cmd === "summary") return summary();
  console.log("Użycie: linkedin:probe -- auth | snapshot [DOMENY|--all] | changelog [--enable] | summary | history");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
