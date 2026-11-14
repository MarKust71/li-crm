import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { PasskeyRegisterButton } from "@/components/passkey-buttons";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { passkeysConfigured } from "@/lib/auth/webauthn";
import { prisma } from "@/lib/prisma";
import { deletePasskeyAction } from "./actions";

export const metadata: Metadata = { title: "Bezpieczeństwo · li-crm" };

const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });

export default function SecurityPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Bezpieczeństwo</h1>
        <SiteNav current="security" />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Ładuję…</p>}>
        <SecurityContent />
      </Suspense>
    </main>
  );
}

async function SecurityContent() {
  const keys = await prisma.passkey.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Klucze dostępu (Touch ID)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Logowanie odciskiem palca zamiast hasła. Klucz jest przypięty do tej domeny, a klucz prywatny zostaje na urządzeniu.
          Hasło nadal działa jako zapasowa droga.
        </p>
        {keys.length === 0 ? (
          <p className="text-sm">Nie masz jeszcze żadnego klucza dostępu.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{k.name}</strong>
                    {k.backedUp && <Badge variant="secondary">synchronizowany</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    dodany {dateFmt.format(k.createdAt)} · {k.lastUsedAt ? `ostatnio użyty ${dateFmt.format(k.lastUsedAt)}` : "jeszcze nie użyty"}
                  </p>
                </div>
                <ConfirmDeleteDialog
                  fieldName="passkeyId"
                  id={k.id}
                  action={deletePasskeyAction}
                  title="Usunąć klucz dostępu?"
                  description="Po usunięciu nie zalogujesz się tym kluczem. Hasło nadal działa. Klucz możesz dodać ponownie."
                />
              </li>
            ))}
          </ul>
        )}
        {passkeysConfigured() ? (
          <PasskeyRegisterButton />
        ) : (
          <p className="text-sm text-destructive">Klucze dostępu są wyłączone: brak AUTH_RP_ID i AUTH_ORIGIN na serwerze.</p>
        )}
      </CardContent>
    </Card>
  );
}
