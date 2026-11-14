import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Elapsed } from "@/components/elapsed";
import { getRunningEntry } from "@/lib/time";

type Props = { current: "contacts" | "time" };

/** Wspólna nawigacja; gdy trwa sesja czasu pracy, pokazuje jej licznik na każdej stronie. */
export function SiteNav({ current }: Props) {
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Główna nawigacja">
      <Button asChild size="sm" variant={current === "contacts" ? "secondary" : "ghost"}>
        <Link href="/contacts">Kontakty</Link>
      </Button>
      <Button asChild size="sm" variant={current === "time" ? "secondary" : "ghost"}>
        <Link href="/time">Czas pracy</Link>
      </Button>
      <Suspense fallback={null}>
        <RunningBadge />
      </Suspense>
    </nav>
  );
}

async function RunningBadge() {
  const running = await getRunningEntry();
  if (!running) return null;
  return (
    <Link
      href="/time"
      className="ml-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
      title="Trwa sesja czasu pracy"
    >
      <span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden />
      <Elapsed startedAt={running.startedAt.getTime()} className="font-mono tabular-nums" />
      {running.activityType && <span className="max-w-40 truncate text-muted-foreground">{running.activityType.name}</span>}
    </Link>
  );
}
