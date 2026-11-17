"use client";

import { useNow } from "@/stores/clock-store";
import { formatClock } from "@/lib/format";

/**
 * Licznik trwającej sesji (HH:MM:SS), czas netto: bez przerw (`pausedSeconds`); w pauzie (`pausedAt`) stoi.
 * Przed pierwszym ticknięciem pokazuje myślniki (zgodność z SSR).
 */
export function Elapsed({
  startedAt, pausedAt = null, pausedSeconds = 0, className,
}: { startedAt: number; pausedAt?: number | null; pausedSeconds?: number; className?: string }) {
  const now = useNow();
  const end = pausedAt ?? now;
  return (
    <span className={className} suppressHydrationWarning>
      {now === 0 ? "--:--:--" : formatClock(Math.max(0, (end - startedAt) / 1000 - pausedSeconds))}
    </span>
  );
}
