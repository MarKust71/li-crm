"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PendingCancel, PendingWatch, usePendingDialog } from "@/components/pending-dialog";
import { SubmitButton } from "@/components/submit-button";

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
  /** Napis na przycisku potwierdzenia w trakcie akcji. */
  pendingLabel?: string;
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
  pendingLabel = "Usuwam…",
  extra,
}: Props) {
  const pendingDialog = usePendingDialog();
  return (
    <AlertDialog {...pendingDialog.dialog}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent {...pendingDialog.content}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <form action={action} className="contents">
            <input type="hidden" name={fieldName} value={id} />
            {Object.entries(extra ?? {}).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <PendingWatch {...pendingDialog.watch} />
            <PendingCancel>Anuluj</PendingCancel>
            <SubmitButton variant="destructive" pendingLabel={pendingLabel}>
              {confirmLabel}
            </SubmitButton>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
