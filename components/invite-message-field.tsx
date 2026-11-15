"use client";

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { inviteMessage } from "@/lib/invite-message";

const salutationInput = () => document.getElementById("salutation") as HTMLInputElement | null;

/**
 * Pole treści zaproszenia z podpowiedzią. Podpowiedź odświeża się, gdy zmieniasz pole „Zwrot” (na żywo, jeszcze przed zapisem) albo gdy zapisany
 * zwrot zmieni się na serwerze, ale tylko dopóki sam nie zmienisz treści: wpisany przez Ciebie tekst nie jest nadpisywany.
 */
export function InviteMessageField({ salutation }: { salutation: string | null }) {
  const suggestion = inviteMessage(salutation);
  const [text, setText] = useState(suggestion);
  const [seen, setSeen] = useState(suggestion);
  const [edited, setEdited] = useState(false);

  // zapisany zwrot zmienił się na serwerze (po zapisie formularza „Edytuj dane”)
  if (seen !== suggestion) {
    setSeen(suggestion);
    if (!edited) setText(suggestion);
  }

  useEffect(() => {
    const el = salutationInput();
    if (!el) return;
    const onInput = () => {
      if (!edited) setText(inviteMessage(el.value));
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, [edited]);

  return (
    <Textarea
      id="next-message"
      name="message"
      rows={3}
      maxLength={5000}
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        // "ręczna" zmiana = niepusty tekst różny od bieżącej podpowiedzi; puste pole lub powrót do podpowiedzi znów włącza aktualizację
        setEdited(v !== "" && v !== inviteMessage(salutationInput()?.value ?? salutation));
      }}
    />
  );
}
