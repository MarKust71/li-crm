"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Odświeża dane bieżącej strony co kilka sekund, dopóki jest wyświetlony (np. pasek kolejki synchronizacji znika sam po opróżnieniu kolejki). */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
