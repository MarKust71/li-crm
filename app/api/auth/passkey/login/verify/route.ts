import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { getAuthConfig } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/redirect";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth/session";
import { consumeChallenge, getRelyingParty, isSameOriginJson } from "@/lib/auth/webauthn";
import { logActivity, logLoginFailure } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";

const INVALID = async (reason: string) => {
  await logLoginFailure("passkey", reason, null);
  return Response.json({ error: "invalid" }, { status: 401 }); // jedna odpowiedź na wszystkie błędy weryfikacji
};

export async function POST(request: Request) {
  const rp = getRelyingParty(request);
  const config = getAuthConfig();
  if (!rp || !config) return Response.json({ error: "passkeys_unavailable" }, { status: 503 });
  if (!isSameOriginJson(request, rp)) return Response.json({ error: "forbidden" }, { status: 403 });

  let body: { response?: AuthenticationResponseJSON; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const response = body.response;
  if (!response || typeof response !== "object" || typeof response.id !== "string") return Response.json({ error: "bad_request" }, { status: 400 });

  // wyzwanie zużywamy zawsze, także przy błędzie: jedna próba na wyzwanie
  const expectedChallenge = await consumeChallenge("login");
  if (!expectedChallenge) return INVALID("brak lub wygasłe wyzwanie");

  const passkey = await prisma.passkey.findUnique({ where: { credentialId: response.id } });
  if (!passkey) return INVALID("nieznany klucz");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransport[],
      },
      requireUserVerification: true,
    });
  } catch {
    return INVALID("weryfikacja podpisu nie powiodła się");
  }
  if (!verification.verified) return INVALID("weryfikacja podpisu nie powiodła się");

  const newCounter = BigInt(verification.authenticationInfo.newCounter);
  await prisma.passkey.update({
    where: { id: passkey.id },
    data: { lastUsedAt: new Date(), counter: newCounter > passkey.counter ? newCounter : passkey.counter },
  });

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(config.secret), sessionCookieOptions);
  await logActivity({ source: "AUTH", action: "auth.login", summary: `Zalogowano kluczem dostępu: ${passkey.name}` });
  return Response.json({ ok: true, next: safeNext(body.next) });
}
