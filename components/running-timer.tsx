"use client";

import { useActionState } from "react";
import { quickStopAction, type QuickStopState } from "@/app/time/actions";
import { Elapsed } from "@/components/elapsed";
import { SubmitButton } from "@/components/submit-button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Props = {
  entryId: string;
  startedAt: number;
  activityId: string | null;
  activityName: string | null;
  activities: { id: string; name: string }[];
};

/** Licznik trwającej sesji w nawigacji; kliknięcie otwiera okienko zatrzymania (godzina końca, czynność, liczba sztuk). */
export function RunningTimer({ entryId, startedAt, activityId, activityName, activities }: Props) {
  const [state, action] = useActionState<QuickStopState, FormData>(quickStopAction, null);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm hover:bg-muted"
          title="Trwa sesja czasu pracy: kliknij, aby zatrzymać"
        >
          <span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden />
          <Elapsed startedAt={startedAt} className="font-mono tabular-nums" />
          {activityName && <span className="max-w-40 truncate text-muted-foreground">{activityName}</span>}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Zatrzymać rejestrowanie czasu?</AlertDialogTitle>
          <AlertDialogDescription>
            Sesja trwa <Elapsed startedAt={startedAt} className="font-mono tabular-nums" />. Zostaw godzinę pustą, aby zakończyć teraz.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={entryId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qs-end">Zakończ o (puste = teraz)</Label>
            <Input id="qs-end" type="datetime-local" name="endedAt" className="w-56" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qs-activity">Czynność</Label>
            <NativeSelect id="qs-activity" name="activityId" defaultValue={activityId ?? ""}>
              <NativeSelectOption value="">(bez czynności)</NativeSelectOption>
              {activities.map((a) => (
                <NativeSelectOption key={a.id} value={a.id}>
                  {a.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qs-new">lub nowa czynność</Label>
            <Input id="qs-new" name="newActivity" maxLength={100} placeholder="nazwa (ma pierwszeństwo przed listą)" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qs-count">Liczba sztuk (opcjonalnie)</Label>
            <Input id="qs-count" name="count" inputMode="numeric" className="w-28" />
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <SubmitButton variant="destructive" pendingLabel="Zatrzymuję…">
              Zatrzymaj
            </SubmitButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
