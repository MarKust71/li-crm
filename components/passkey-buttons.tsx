"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Spinner } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const subscribe = () => () => {};
/** Wsparcie WebAuthn znamy dopiero w przeglądarce; na serwerze zakładamy brak (bez błędu hydracji). */
const useSupported = () => useSyncExternalStore(subscribe, browserSupportsWebAuthn, () => false);

function postJson(url: string, body: unknown = {}) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
}

function describeError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError") return "Anulowano albo upłynął czas.";
  if (name === "InvalidStateError") return "Ten klucz jest już zarejestrowany.";
  return "Nie udało się. Spróbuj ponownie albo użyj hasła.";
}

/** "Mac (Chrome)" itp.: domyślna nazwa klucza, liczona w przeglądarce w chwili kliknięcia. */
function guessName(): string {
  const ua = navigator.userAgent;
  const os = /Mac/i.test(ua) ? "Mac" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : "Urządzenie";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "przeglądarka";
  return `${os} (${browser})`;
}

export function PasskeyLoginButton({ next }: { next: string }) {
  const supported = useSupported();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!supported) return null;

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const optRes = await postJson("/api/auth/passkey/login/options");
      if (!optRes.ok) throw new Error("options");
      const response = await startAuthentication({ optionsJSON: await optRes.json() });
      const res = await postJson("/api/auth/passkey/login/verify", { response, next });
      if (!res.ok) throw new Error("verify");
      window.location.assign((await res.json()).next ?? "/dashboard"); // pełne przeładowanie: dostajemy ciasteczko sesji
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={busy} aria-busy={busy} onClick={login}>
        {busy && <Spinner />}
        {busy ? "Loguję…" : "Zaloguj przez Touch ID"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function PasskeyRegisterButton() {
  const supported = useSupported();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!supported) {
    return <p className="text-sm text-muted-foreground">Ta przeglądarka nie obsługuje kluczy dostępu.</p>;
  }

  async function register() {
    setBusy(true);
    setMessage(null);
    try {
      const optRes = await postJson("/api/auth/passkey/register/options");
      if (optRes.status === 409) throw Object.assign(new Error("limit"), { name: "Limit" });
      if (!optRes.ok) throw new Error("options");
      const response = await startRegistration({ optionsJSON: await optRes.json() });
      const res = await postJson("/api/auth/passkey/register/verify", { response, name: name.trim() || guessName() });
      if (!res.ok) throw new Error("verify");
      setName("");
      setMessage({ ok: true, text: "Dodano klucz dostępu." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error && e.name === "Limit" ? "Osiągnięto limit kluczy. Usuń nieużywany." : describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="passkey-name">Nazwa (opcjonalnie)</Label>
          <Input id="passkey-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="np. MacBook Pro" className="w-56" />
        </div>
        <Button type="button" disabled={busy} aria-busy={busy} onClick={register}>
          {busy && <Spinner />}
          {busy ? "Dodaję…" : "Dodaj klucz dostępu (Touch ID)"}
        </Button>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
