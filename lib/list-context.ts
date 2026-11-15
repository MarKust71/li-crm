import { headers } from "next/headers";
import { listContextFrom } from "./contacts";

/** Kontekst listy kontaktów (`from`) z adresu strony, z której wysłano formularz (Referer), sprawdzony i zapisany od nowa; pusty, gdy go nie ma. */
export async function refererListQuery(): Promise<string> {
  try {
    const referer = (await headers()).get("referer");
    const raw = referer ? new URL(referer).searchParams.get("from") : null;
    return raw ? listContextFrom(raw).query : "";
  } catch {
    return "";
  }
}
