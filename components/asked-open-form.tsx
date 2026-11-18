"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  children: ReactNode;
};

/**
 * Formularz dodawania zdarzenia. Dla „Zapytano o otwartość na rozmowę” (ASKED_OPEN) przed zapisem pyta,
 * czy założyć standardowe przypomnienia (7 dni, 4 tygodnie, 6 miesięcy): Tak / Nie / Anuluj.
 * Wybór trafia do akcji jako `standardReminders` (1 = tak, 0 = nie).
 */
export function AskedOpenForm({ action, className, children }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const choiceRef = useRef<HTMLInputElement>(null);
  const submitterRef = useRef<HTMLElement | null>(null);
  const confirmedRef = useRef(false);
  const [open, setOpen] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const field = submitter?.name === "type" ? submitter.value : (formRef.current?.elements.namedItem("type") as HTMLSelectElement | null)?.value;
    if (field !== "ASKED_OPEN") return;
    e.preventDefault();
    submitterRef.current = submitter;
    setOpen(true);
  }

  function choose(standard: boolean) {
    if (choiceRef.current) choiceRef.current.value = standard ? "1" : "0";
    confirmedRef.current = true;
    setOpen(false);
    const form = formRef.current;
    if (!form) return;
    const submitter = submitterRef.current;
    if (submitter && form.contains(submitter)) form.requestSubmit(submitter);
    else form.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={action} onSubmit={onSubmit} className={className}>
        <input ref={choiceRef} type="hidden" name="standardReminders" defaultValue="1" />
        {children}
      </form>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Czy dodać standardowe powiadomienia?</AlertDialogTitle>
            <AlertDialogDescription>
              Zostaną utworzone trzy przypomnienia: po 7 dniach, po 4 tygodniach i po 6 miesiącach od daty zdarzenia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <Button type="button" variant="outline" onClick={() => choose(false)}>
              Nie
            </Button>
            <Button type="button" onClick={() => choose(true)}>
              Tak
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
