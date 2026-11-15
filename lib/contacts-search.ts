// Składnia pola "Szukaj" na liście kontaktów (czysta funkcja, bez bazy):
//   a b        → LUB: rekordy z "a" albo z "b"
//   a+b        → ORAZ: rekord ma i "a", i "b" (w dowolnych polach)
//   "a b"      → dokładny ciąg "a b"
//   a+b c      → (a ORAZ b) LUB c   (plus wiąże silniej niż spacja; bez nawiasów)
// Każde słowo jest szukane w imieniu i nazwisku, zajęciu, lokalizacji i adresie profilu.

export const MAX_GROUPS = 8;
export const MAX_TERMS = 6;

/** Lista grup LUB; każda grupa to lista słów połączonych ORAZ. */
export function parseSearch(q: string): string[][] {
  const groups: string[][] = [];
  let group: string[] = [];
  let term = "";
  let quoted = false;

  const endTerm = () => {
    const t = term.trim();
    if (t && group.length < MAX_TERMS) group.push(t);
    term = "";
  };
  const endGroup = () => {
    endTerm();
    if (group.length && groups.length < MAX_GROUPS) groups.push(group);
    group = [];
  };

  for (const ch of q) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && /\s/.test(ch)) endGroup();
    else if (!quoted && ch === "+") endTerm();
    else term += ch;
  }
  endGroup();
  return groups;
}
