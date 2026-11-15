// Podpowiadana treść zaproszenia ("Zaproszenie wysłane"). Czysta funkcja, używana na serwerze i w przeglądarce (podgląd na żywo przy edycji pola Zwrot).

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
