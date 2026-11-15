"use client";

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { suggestedMessage, type SuggestedStep } from "@/lib/invite-message";

const salutationInput = () =>
  document.getElementById("salutation") as HTMLInputElement | null;

/**
 * Pole treści wiadomości z podpowiedzią dla kroku (zaproszenie wysłane / zaakceptowane). Podpowiedź odświeża się, gdy zmieniasz pole „Zwrot” (na żywo, jeszcze przed zapisem) albo gdy zapisany
 * zwrot zmieni się na serwerze, ale tylko dopóki sam nie zmienisz treści: wpisany przez Ciebie tekst nie jest nadpisywany.
 */
export function StepMessageField({
  step,
  salutation,
}: {
  step: SuggestedStep;
  salutation: string | null;
}) {
  const suggestion = suggestedMessage(step, salutation);
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
      if (!edited) setText(suggestedMessage(step, el.value));
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, [edited, step]);

  return (
    <>
      {/* serwer pomija nietkniętą podpowiedź, gdy klikniesz inny krok niż ten, dla którego ją przygotowano (np. „Zaproszenie wycofane”) */}
      <input type="hidden" name="suggestedFor" value={step} />
      <input
        type="hidden"
        name="suggestionUntouched"
        value={edited ? "0" : "1"}
      />
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
          setEdited(
            v !== "" &&
              v !==
                suggestedMessage(step, salutationInput()?.value ?? salutation),
          );
        }}
      />
    </>
  );
}
