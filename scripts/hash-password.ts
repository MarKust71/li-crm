// Generuje skrót hasła do logowania (i opcjonalnie klucz podpisu sesji). Hasło nigdzie nie jest zapisywane.
//
//   npx tsx scripts/hash-password.ts            # pyta o hasło (ukryte), drukuje AUTH_PASSWORD_HASH=…
//   npx tsx scripts/hash-password.ts --secret   # dodatkowo drukuje wygenerowany AUTH_SECRET=…
//
// Uruchom w zwykłym terminalu (nie przez "!" w sesji Claude Code), żeby wpisywanie było ukryte.
// Bez terminala (potok) skrypt czyta hasło z pierwszej linii stdin.
import { randomBytes } from "node:crypto";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword } from "../lib/auth/password";

async function readHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").split("\n")[0].replace(/\r$/, "");
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          return resolve(buf);
        }
        if (c === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const interactive = Boolean(process.stdin.isTTY);
  const password = await readHidden("Nowe hasło: ");
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    console.error(`Hasło musi mieć od ${MIN_PASSWORD_LENGTH} do ${MAX_PASSWORD_LENGTH} znaków.`);
    process.exit(1);
  }
  if (interactive && (await readHidden("Powtórz hasło: ")) !== password) {
    console.error("Hasła się różnią.");
    process.exit(1);
  }
  console.log(`AUTH_PASSWORD_HASH=${await hashPassword(password)}`);
  if (process.argv.includes("--secret")) console.log(`AUTH_SECRET=${randomBytes(48).toString("base64url")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
