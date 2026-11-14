import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { RunningTimer } from "@/components/running-timer";
import pkg from "../package.json";
import { countDue } from "@/lib/reminders";
import { getRunningEntry, listActivityTypes } from "@/lib/time";

type Props = { current: "contacts" | "today" | "time" | "stats" | "log" | "settings" | "security" };

/** Wspólna nawigacja; gdy trwa sesja czasu pracy, pokazuje jej licznik na każdej stronie. */
export function SiteNav({ current }: Props) {
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Główna nawigacja">
      <Button asChild size="sm" variant={current === "contacts" ? "secondary" : "ghost"}>
        <Link href="/contacts">Kontakty</Link>
      </Button>
      <Suspense
        fallback={
          <Button asChild size="sm" variant={current === "today" ? "secondary" : "ghost"}>
            <Link href="/today">Dziś</Link>
          </Button>
        }
      >
        <TodayLink current={current} />
      </Suspense>
      <Button asChild size="sm" variant={current === "time" ? "secondary" : "ghost"}>
        <Link href="/time">Czas pracy</Link>
      </Button>
      <Suspense fallback={null}>
        <RunningBadge />
      </Suspense>
      <Button asChild size="sm" variant={current === "stats" ? "secondary" : "ghost"}>
        <Link href="/stats">Statystyki</Link>
      </Button>
      <Button asChild size="sm" variant={current === "log" ? "secondary" : "ghost"}>
        <Link href="/log">Dziennik</Link>
      </Button>
      <Button asChild size="sm" variant={current === "settings" ? "secondary" : "ghost"}>
        <Link href="/settings">Ustawienia</Link>
      </Button>
      <Button asChild size="sm" variant={current === "security" ? "secondary" : "ghost"}>
        <Link href="/security">Bezpieczeństwo</Link>
      </Button>
      <span className="ml-2 text-xs tabular-nums text-muted-foreground" title="Wersja aplikacji (package.json)">
        v{pkg.version}
      </span>
      <Suspense fallback={null}>
        <LogoutButton />
      </Suspense>
    </nav>
  );
}

async function RunningBadge() {
  const [running, activities] = await Promise.all([getRunningEntry(), listActivityTypes()]);
  if (!running) return null;
  return (
    <RunningTimer
      entryId={running.id}
      startedAt={running.startedAt.getTime()}
      activityId={running.activityType?.id ?? null}
      activityName={running.activityType?.name ?? null}
      activities={activities.map((a) => ({ id: a.id, name: a.name }))}
    />
  );
}

async function TodayLink({ current }: Props) {
  const due = await countDue();
  return (
    <Button asChild size="sm" variant={current === "today" ? "secondary" : "ghost"}>
      <Link href="/today">
        Dziś
        {due > 0 && (
          <span className="ml-1 rounded-full bg-destructive px-1.5 text-xs font-medium text-white tabular-nums">{due}</span>
        )}
      </Link>
    </Button>
  );
}

/** Zależy od żądania (ciasteczko sesji), więc jest poza statyczną częścią strony: nie zależy od zmiennych z czasu budowania. */
async function LogoutButton() {
  if (!(await cookies()).get(SESSION_COOKIE)) return null;
  return (
    <form action={logoutAction}>
      <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground">
        Wyloguj
      </Button>
    </form>
  );
}
