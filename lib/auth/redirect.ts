/** Adres powrotu po logowaniu: tylko względny i wewnętrzny (blokuje "//host", "https://…", "\\host" i pętlę na /login). */
export function safeNext(value: unknown): string {
  const s = typeof value === "string" ? value : "";
  return /^\/(?!\/)[A-Za-z0-9\-._~%/?=&]{0,500}$/.test(s) && !s.startsWith("/login") && !s.startsWith("/api/") ? s : "/contacts";
}
