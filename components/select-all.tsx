"use client";

/** Pole „zaznacz wszystkie”: przełącza wszystkie pola `ids` w tym samym formularzu (lista na bieżącej stronie). */
export function SelectAll({ label = "Zaznacz wszystkie na stronie" }: { label?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          for (const el of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="ids"]')) el.checked = e.currentTarget.checked;
        }}
      />
      {label}
    </label>
  );
}
