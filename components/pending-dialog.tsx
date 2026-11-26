"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { AlertDialogCancel } from "@/components/ui/alert-dialog";

/**
 * Okienko z formularzem, które zostaje otwarte do końca akcji serwera. `open`/`onOpenChange` trafiają do `AlertDialog`,
 * `onEscapeKeyDown` do `AlertDialogContent`, a `<PendingWatch {...watch} />` musi być wewnątrz formularza.
 * Z `closeWhenDone: false` okienko po akcji zostaje otwarte (np. żeby pokazać błąd).
 */
export function usePendingDialog({ closeWhenDone = true }: { closeWhenDone?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  return {
    dialog: { open, onOpenChange: setOpen },
    content: {
      onEscapeKeyDown: (e: KeyboardEvent) => {
        if (busy.current) e.preventDefault();
      },
    },
    watch: {
      onPendingChange: (pending: boolean) => {
        if (closeWhenDone && busy.current && !pending) setOpen(false);
        busy.current = pending;
      },
    },
  };
}

/** Przekazuje do `usePendingDialog` stan wysyłania formularza, w którym się znajduje. */
export function PendingWatch({ onPendingChange }: { onPendingChange: (pending: boolean) => void }) {
  const { pending } = useFormStatus();
  const callback = useRef(onPendingChange);
  useEffect(() => {
    callback.current = onPendingChange;
  });
  useEffect(() => {
    callback.current(pending);
  }, [pending]);
  return null;
}

/** „Anuluj” nieaktywne w trakcie akcji (operacji już wysłanej nie da się cofnąć). Musi być wewnątrz formularza. */
export function PendingCancel(props: ComponentProps<typeof AlertDialogCancel>) {
  const { pending } = useFormStatus();
  return <AlertDialogCancel {...props} disabled={pending} />;
}
