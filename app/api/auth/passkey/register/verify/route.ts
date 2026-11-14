import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { hasAccess } from "@/lib/access";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";
import { MAX_PASSKEYS, consumeChallenge, getRelyingParty, isSameOriginJson } from "@/lib/auth/webauthn";

export async function POST(request: Request) {
  const rp = getRelyingParty(request);
  if (!rp) return Response.json({ error: "passkeys_unavailable" }, { status: 503 });
  if (!isSameOriginJson(request, rp)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!(await hasAccess())) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { response?: RegistrationResponseJSON; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.response || typeof body.response !== "object") return Response.json({ error: "bad_request" }, { status: 400 });

  const expectedChallenge = await consumeChallenge("register");
  if (!expectedChallenge) return Response.json({ error: "challenge_expired" }, { status: 400 });

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch {
    return Response.json({ error: "verification_failed" }, { status: 400 });
  }
  if (!verification.verified) return Response.json({ error: "verification_failed" }, { status: 400 });

  if ((await prisma.passkey.count()) >= MAX_PASSKEYS) return Response.json({ error: "too_many" }, { status: 409 });
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const name = (typeof body.name === "string" ? body.name.trim() : "").slice(0, 60) || "Klucz dostępu";
  try {
    await prisma.passkey.create({
      data: {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? body.response.response.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name,
      },
    });
  } catch {
    return Response.json({ error: "already_registered" }, { status: 409 }); // ten sam klucz dwa razy (unikalny credentialId)
  }
  await logActivity({ source: "AUTH", action: "auth.passkey_added", summary: `Dodano klucz dostępu: ${name}` });
  return Response.json({ ok: true });
}
