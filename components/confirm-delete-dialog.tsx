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
};

/** Potwierdzenie nieodwracalnego usunięcia; wysyła zwykły formularz do Server Action. */
export function ConfirmDeleteDialog({ fieldName, id, action, title, description }: Props) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          usuń
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
            <AlertDialogAction type="submit" variant="destructive">
              Usuń
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
