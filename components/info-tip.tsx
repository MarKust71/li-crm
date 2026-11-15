"use client";

import { Info } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";

/** Znaczek (i) z podpowiedzią po najechaniu myszą albo ustawieniu fokusu (klawiatura, dotyk). */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" aria-label={label} className="inline-flex -translate-y-1 text-muted-foreground hover:text-foreground">
            <Info className="size-3" aria-hidden />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className="z-50 max-w-xs rounded-md border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md"
          >
            {children}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
