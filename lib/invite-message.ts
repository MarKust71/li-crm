// Podpowiadane treści wiadomości dla kroków "Zaproszenie wysłane" i "Podziękowanie wysłane". Czyste funkcje, używane na serwerze
// i w przeglądarce (podgląd na żywo przy edycji pola Zwrot).

const isMale = (salutation: string) => /^pan(ie)?(\s|$)/i.test(salutation.trim()); // "Panie Piotrze" (wołacz) i "Pan Marek"; "Pani Aniu" to co innego

/**
 * "Dzień dobry[, <Zwrot>] 🙂 Serdecznie zapraszam Panią do grona moich kontaktów 🙂 …".
 * Bez zwrotu albo ze zwrotem "Pani …" tekst jest w formie żeńskiej (jak w wzorze); ze zwrotem "Panie …" / "Pan …" w męskiej (Pana, Pan otwarty).
 */
export function inviteMessage(salutation: string | null | undefined): string {
  const s = salutation?.trim() ?? "";
  const male = s ? isMale(s) : false;
  const nom = male ? "Pan" : "Pani";
  const acc = male ? "Pana" : "Panią";
  const open = male ? "otwarty" : "otwarta";
  return `Dzień dobry${s ? `, ${s}` : ""} 🙂 Serdecznie zapraszam ${acc} do grona moich kontaktów 🙂 To doskonałe towarzystwo 🙂 Szczególnie przydatne, jeśli jest ${nom} ${open} na nowe szanse i wyzwania. Co ${nom} na to? 🙂 Marek`;
}

/**
 * Podziękowanie po przyjęciu zaproszenia (krok "Podziękowanie wysłane"; samo "Zaproszenie zaakceptowane" nie ma treści):
 * "Dziękuję za przyjęcie zaproszenia[, <Zwrot>] 🙂 Bardzo się cieszę, że mogę Panią poznać 🙂 Marek" (forma męska ze zwrotem "Pan…/Panie…").
 */
export function thanksMessage(salutation: string | null | undefined): string {
  const s = salutation?.trim() ?? "";
  const acc = s && isMale(s) ? "Pana" : "Panią";
  return `Dziękuję za przyjęcie zaproszenia${s ? `, ${s}` : ""} 🙂 Bardzo się cieszę, że mogę ${acc} poznać 🙂 Marek`;
}

/** Kroki, dla których podpowiadamy treść wiadomości. */
export type SuggestedStep = "INVITE_SENT" | "THANKS_SENT";

export const isSuggestedStep = (t: string | undefined): t is SuggestedStep => t === "INVITE_SENT" || t === "THANKS_SENT";

export function suggestedMessage(step: SuggestedStep, salutation: string | null | undefined): string {
  return step === "INVITE_SENT" ? inviteMessage(salutation) : thanksMessage(salutation);
}

// ───────── Treści przypomnień po "Zapytano o otwartość na rozmowę" (tworzone automatycznie, patrz lib/reminders.ts) ─────────

const greeting = (s: string) => `Dzień dobry${s ? `, ${s}` : ""}`;

/** Po 7 dniach: delikatne przypomnienie. */
export function followUpWeekMessage(salutation: string | null | undefined): string {
  const s = salutation?.trim() ?? "";
  const male = s ? isMale(s) : false;
  return `${greeting(s)} 🙂 Przypominam się tylko delikatnie, bo wiem, że mógł${male ? "" : "a"} być ${male ? "Pan zajęty" : "Pani zajęta"} w ostatnich dniach. Gdyby znalazł${male ? "" : "a"} ${male ? "Pan" : "Pani"} chwilę na krótką wymianę zdań online, zapraszam serdecznie.`;
}

/** Po 4 tygodniach: wiadomość bez wołacza. */
export function followUpMonthMessage(salutation: string | null | undefined): string {
  const s = salutation?.trim() ?? "";
  const nom = s && isMale(s) ? "Pan" : "Pani";
  return `Widzę, że teraz prawdopodobnie ma ${nom} pełne ręce roboty, więc na pewno nie będę wracał do tematu przez najbliższe kilka miesięcy. Gdyby jednak w międzyczasie pojawiła się przestrzeń na 40 minut rozmowy, wie ${nom}, gdzie mnie znaleźć 🙂`;
}

/** Po 6 miesiącach: powrót do kontaktu. */
export function followUpHalfYearMessage(salutation: string | null | undefined): string {
  const s = salutation?.trim() ?? "";
  const who = s && isMale(s) ? "Pana" : "Pani";
  return `${s ? `Dzień dobry, ${s}!` : "Dzień dobry!"} Dawno nie rozmawialiśmy, co dobrego słychać u ${who} zawodowo? 🙂`;
}
