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
  eventId: string;
  /** Server Action usuwająca zdarzenie (przekazana z komponentu serwerowego). */
  action: (formData: FormData) => void | Promise<void>;
};

/** Potwierdzenie usunięcia zdarzenia z historii kontaktu. */
export function DeleteEventDialog({ eventId, action }: Props) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          usuń
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunąć zdarzenie?</AlertDialogTitle>
          <AlertDialogDescription>
            Tej operacji nie można cofnąć. Etap kontaktu zostanie przeliczony bez tego zdarzenia.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <form action={action}>
            <input type="hidden" name="eventId" value={eventId} />
            <AlertDialogAction type="submit" variant="destructive">
              Usuń
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
