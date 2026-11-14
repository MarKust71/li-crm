"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  /** Nazwa pola formularza, pod którą akcja odbiera identyfikator (np. "eventId"). */
  fieldName: string;
  id: string;
  /** Server Action usuwająca rekord (przekazana z komponentu serwerowego). */
  action: (formData: FormData) => void | Promise<void>;
  title: string;
  description: string;
  /** Etykiety (domyślnie "usuń" / "Usuń") i dodatkowe ukryte pola formularza (np. adres powrotu). */
  triggerLabel?: string;
  confirmLabel?: string;
  extra?: Record<string, string>;
};

/** Potwierdzenie nieodwracalnego usunięcia; wysyła zwykły formularz do Server Action. */
export function ConfirmDeleteDialog({
  fieldName,
  id,
  action,
  title,
  description,
  triggerLabel = "usuń",
  confirmLabel = "Usuń",
  extra,
}: Props) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <form action={action}>
            <input type="hidden" name={fieldName} value={id} />
            {Object.entries(extra ?? {}).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <AlertDialogAction type="submit" variant="destructive">
              {confirmLabel}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
