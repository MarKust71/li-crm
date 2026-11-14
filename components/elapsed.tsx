"use client";

import { useNow } from "@/stores/clock-store";
import { formatClock } from "@/lib/format";

/** Licznik trwającej sesji (HH:MM:SS). Przed pierwszym ticknięciem pokazuje myślniki (zgodność z SSR). */
export function Elapsed({ startedAt, className }: { startedAt: number; className?: string }) {
  const now = useNow();
  return (
    <span className={className} suppressHydrationWarning>
      {now === 0 ? "--:--:--" : formatClock((now - startedAt) / 1000)}
    </span>
  );
}
