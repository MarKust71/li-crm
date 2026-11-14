"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Przycisk wysyłający formularz: po kliknięciu jest nieaktywny do końca akcji serwera (bez podwójnych kliknięć). */
export function SubmitButton({ pendingLabel, children, className, ...props }: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} className={`cursor-pointer disabled:cursor-wait ${className ?? ""}`} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
