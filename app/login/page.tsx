import type { Metadata } from "next";
import { Suspense } from "react";
import pkg from "../../package.json";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasskeyLoginButton } from "@/components/passkey-buttons";
import { passkeysConfigured } from "@/lib/auth/webauthn";
import { prisma } from "@/lib/prisma";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Logowanie · li-crm" };

const ERRORS: Record<string, string> = {
  invalid: "Nieprawidłowe hasło.",
  locked: "Zbyt wiele nieudanych prób. Spróbuj ponownie za kilkanaście minut.",
  config: "Logowanie nie jest skonfigurowane na serwerze.",
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline justify-between">
            li-crm
            <span className="text-xs font-normal tabular-nums text-muted-foreground">v{pkg.version}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <LoginForm searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function LoginForm({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const error = ERRORS[one(sp.error)];
  const next = one(sp.next);
  // przycisk Touch ID tylko, gdy domena jest skonfigurowana i jest co najmniej jeden klucz
  const showPasskey = passkeysConfigured() && (await prisma.passkey.count()) > 0;

  return (
    <div className="flex flex-col gap-4">
      {showPasskey && (
        <>
          <PasskeyLoginButton next={next} />
          <p className="text-center text-xs text-muted-foreground">albo hasłem</p>
        </>
      )}
      <PasswordForm error={error} next={next} />
    </div>
  );
}

function PasswordForm({ error, next }: { error: string | undefined; next: string }) {
  return (
    <form action={loginAction} className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Hasło</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required maxLength={200} />
      </div>
      <Button type="submit">Zaloguj</Button>
    </form>
  );
}
