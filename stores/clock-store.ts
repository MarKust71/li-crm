import { useEffect } from "react";
import { create } from "zustand";

// Jeden wspólny zegar dla wszystkich liczników na stronie (znaczek w nawigacji i panel sesji):
// jeden setInterval niezależnie od liczby subskrybentów, zatrzymywany, gdy nikt nie słucha.
// Zustand trzyma tylko chwilę "teraz" (stan wyłącznie kliencki). Dane o sesji są w bazie.
type ClockState = { now: number };

// 0 zamiast Date.now(): wartość z modułu liczyłaby się podczas prerenderu (cacheComponents).
export const useClockStore = create<ClockState>(() => ({ now: 0 }));

let timer: ReturnType<typeof setInterval> | undefined;
let subscribers = 0;

function acquire(): () => void {
  subscribers += 1;
  if (!timer) {
    useClockStore.setState({ now: Date.now() });
    timer = setInterval(() => useClockStore.setState({ now: Date.now() }), 1000);
  }
  return () => {
    subscribers -= 1;
    if (subscribers === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Aktualny czas w ms, odświeżany co sekundę; 0 przed pierwszym ticknięciem po stronie klienta. */
export function useNow(): number {
  useEffect(acquire, []);
  return useClockStore((s) => s.now);
}
