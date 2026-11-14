"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { action: (formData: FormData) => void | Promise<void> };

/** Ręczne czyszczenie dziennika: wpisy sprzed daty albo cały dziennik; oba warianty wymagają potwierdzenia. */
export function PurgeLog({ action }: Props) {
  const [before, setBefore] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="purge-before" className="text-xs text-muted-foreground">
          Usuń wpisy sprzed daty
        </Label>
        <Input id="purge-before" type="date" value={before} onChange={(e) => setBefore(e.target.value)} className="w-40" />
      </div>
      <Confirm
        action={action}
        scope="before"
        before={before}
        disabled={!before}
        label="Usuń starsze"
        title="Usunąć starsze wpisy?"
        description={`Wpisy sprzed ${before} (czas warszawski) zostaną trwale usunięte. Tej operacji nie można cofnąć.`}
      />
      <Confirm
        action={action}
        scope="all"
        before=""
        label="Wyczyść cały dziennik"
        title="Wyczyścić cały dziennik?"
        description="Wszystkie wpisy zostaną trwale usunięte. Tej operacji nie można cofnąć."
      />
    </div>
  );
}

function Confirm({ action, scope, before, label, title, description, disabled }: { action: Props["action"]; scope: string; before: string; label: string; title: string; description: string; disabled?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          {label}
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
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="before" value={before} />
            <AlertDialogAction type="submit" variant="destructive">
              Usuń
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
