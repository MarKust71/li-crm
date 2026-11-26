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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PendingCancel, PendingWatch, usePendingDialog } from "@/components/pending-dialog";
import { SubmitButton } from "@/components/submit-button";

type Props = {
  contactId: string;
  viewed: boolean;
  title: string;
  /** Server Action dodająca zdarzenie „Wyświetlił(a) mój profil” (bez daty). */
  action: (formData: FormData) => void | Promise<void>;
};

/**
 * Znacznik „Viewed” w nagłówku karty. Gdy kontakt ma zdarzenie: tylko informuje.
 * Gdy nie: klikalny, ale dodanie zdarzenia (praktycznie nieodwracalne) wymaga potwierdzenia.
 */
export function ViewedBadge({ contactId, viewed, title, action }: Props) {
  const pendingDialog = usePendingDialog();
  if (viewed) {
    return (
      <Badge variant="default" title={title} className="font-semibold">
        Viewed
      </Badge>
    );
  }
  return (
    <AlertDialog {...pendingDialog.dialog}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="xs" title={title} className="rounded-full font-semibold">
          Viewed
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent {...pendingDialog.content}>
        <AlertDialogHeader>
          <AlertDialogTitle>Dodać zdarzenie „Wyświetlił(a) mój profil”?</AlertDialogTitle>
          <AlertDialogDescription>
            Zdarzenie dostanie nieznaną datę (2000-01-01). Operacja jest praktycznie nieodwracalna: żeby ją cofnąć, trzeba usunąć zdarzenie z historii.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <form action={action} className="contents">
            <input type="hidden" name="id" value={contactId} />
            <PendingWatch {...pendingDialog.watch} />
            <PendingCancel>Anuluj</PendingCancel>
            <SubmitButton pendingLabel="Dodaję…">Dodaj</SubmitButton>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
