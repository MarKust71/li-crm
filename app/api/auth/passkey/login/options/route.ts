import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getAuthConfig } from "@/lib/auth/config";
import { getRelyingParty, isSameOriginJson, storeChallenge } from "@/lib/auth/webauthn";

// Publiczny: wyzwanie do podpisania. Nie ujawnia identyfikatorów kluczy (allowCredentials puste: przeglądarka sama
// pokazuje klucz zapisany dla tej domeny).
export async function POST(request: Request) {
  const rp = getRelyingParty(request);
  if (!rp || !getAuthConfig()) return Response.json({ error: "passkeys_unavailable" }, { status: 503 });
  if (!isSameOriginJson(request, rp)) return Response.json({ error: "forbidden" }, { status: 403 });

  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
  if (!(await storeChallenge("login", options.challenge))) return Response.json({ error: "busy" }, { status: 429 });
  return Response.json(options);
}
