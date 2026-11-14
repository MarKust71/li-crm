import { generateRegistrationOptions } from "@simplewebauthn/server";
import { hasAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { MAX_PASSKEYS, getRelyingParty, isSameOriginJson, storeChallenge } from "@/lib/auth/webauthn";

// Rejestracja klucza dostępu wymaga aktywnej sesji (zalogowania hasłem).
export async function POST(request: Request) {
  const rp = getRelyingParty(request);
  if (!rp) return Response.json({ error: "passkeys_unavailable" }, { status: 503 });
  if (!isSameOriginJson(request, rp)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!(await hasAccess())) return Response.json({ error: "unauthorized" }, { status: 401 });

  const existing = await prisma.passkey.findMany({ select: { credentialId: true, transports: true } });
  if (existing.length >= MAX_PASSKEYS) return Response.json({ error: "too_many" }, { status: 409 });

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: "li-crm",
    userDisplayName: "Właściciel li-crm",
    userID: new TextEncoder().encode("li-crm-owner"), // jeden użytkownik: stały identyfikator bez danych osobowych
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
    authenticatorSelection: {
      residentKey: "required", // klucz wykrywalny: logowanie bez podawania nazwy użytkownika
      userVerification: "required", // odcisk palca/PIN, nie samo „dotknięcie”
      authenticatorAttachment: "platform", // wbudowany czytnik (Touch ID); bez tego Chrome najpierw pyta o telefon/klucz
    },
  });
  if (!(await storeChallenge("register", options.challenge))) return Response.json({ error: "busy" }, { status: 429 });
  return Response.json(options);
}
