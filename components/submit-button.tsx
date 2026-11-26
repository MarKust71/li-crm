"use client";

import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Kręcące się kółko „operacja trwa”. */
export function Spinner() {
  return <LoaderCircle className="animate-spin" aria-hidden />;
}

/**
 * Przycisk wysyłający formularz: do końca akcji serwera nieaktywne są wszystkie przyciski formularza (bez podwójnych kliknięć),
 * a kółko i `pendingLabel` pokazuje tylko ten, który go wysłał (rozpoznawany po `formAction` albo po parze `name`/`value`).
 * W przyciskach z samą ikoną kółko zastępuje ikonę.
 */
export function SubmitButton({ pendingLabel, children, className, disabled, ...props }: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending, data, action } = useFormStatus();
  const { formAction, name, value, size } = props;
  const busy = pending && (formAction ? action === formAction : name ? data?.get(name) === String(value) : true);
  const iconOnly = size?.startsWith("icon");
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={busy} className={`disabled:aria-busy:opacity-80 ${className ?? ""}`} {...props}>
      {busy && <Spinner />}
      {busy ? (iconOnly ? null : (pendingLabel ?? children)) : children}
    </Button>
  );
}
