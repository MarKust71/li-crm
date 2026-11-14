import Link from "next/link";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addDays, warsawDateOf } from "@/lib/dates";
import type { ReminderRow } from "@/lib/reminders";
import { RECONNECT_DAYS } from "@/lib/reminders";
import {
  cancelReminderAction,
  completeReminderAction,
  createReminderAction,
  reopenReminderAction,
  rescheduleReminderAction,
} from "@/app/reminders/actions";

const TZ = "Europe/Warsaw";
const dateFmt = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("pl-PL", { timeStyle: "short", timeZone: TZ });

const daysBetween = (fromDate: string, toDate: string) =>
  Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);

/** "po terminie: 3 dni", "dziś", "jutro", "za 5 dni". */
function dueLabel(r: ReminderRow, today: string): { text: string; overdue: boolean } {
  const diff = daysBetween(today, warsawDateOf(r.dueAt));
  if (diff < 0) return { text: `po terminie: ${-diff} ${-diff === 1 ? "dzień" : "dni"}`, overdue: true };
  if (diff === 0) return { text: "dziś", overdue: false };
  if (diff === 1) return { text: "jutro", overdue: false };
  return { text: `za ${diff} dni`, overdue: false };
}

/** Notatka z klikalnymi adresami (np. wątek LinkedIn); tylko http(s). */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">
            {part.includes("/messaging/thread/") ? "wątek LinkedIn ↗" : part.replace(/^https?:\/\//, "").slice(0, 40)}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

type ItemProps = {
  r: ReminderRow;
  /** Dzisiejsza data ("YYYY-MM-DD"), liczona po stronie serwera w kontekście żądania. */
  today: string;
  /** Dokąd wrócić po akcji (lista "Dziś" albo karta kontaktu). */
  back: string;
  showContact?: boolean;
};

export function ReminderItem({ r, today, back, showContact = true }: ItemProps) {
  const due = dueLabel(r, today);
  const isDone = r.status === "DONE";
  const hidden = (
    <>
      <input type="hidden" name="reminderId" value={r.id} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  return (
    <li className={`rounded-lg border p-3 ${isDone ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {showContact && (
          <Link href={`/contacts/${r.contact.id}`} className="font-semibold hover:underline">
            {r.contact.name}
          </Link>
        )}
        <Badge variant={r.kind === "RECONNECT" ? "default" : "secondary"}>
          {r.kind === "RECONNECT" ? "Re-connect" : "Przypomnienie"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {dateFmt.format(r.dueAt)}
          {!r.allDay && `, ${timeFmt.format(r.dueAt)}`}
        </span>
        {isDone ? (
          <Badge variant="outline">odbyte</Badge>
        ) : (
          <span className={`text-sm ${due.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{due.text}</span>
        )}
        {showContact && (
          <a href={r.contact.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline">
            LinkedIn ↗
          </a>
        )}
      </div>
      {r.note && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          <Linkified text={r.note} />
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {isDone ? (
          <form action={reopenReminderAction}>
            {hidden}
            <Button type="submit" variant="ghost" size="xs" className="text-muted-foreground">
              cofnij
            </Button>
          </form>
        ) : (
          <>
            <form action={completeReminderAction}>
              {hidden}
              <Button type="submit" size="sm">
                Zrobione
              </Button>
            </form>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Przełóż</summary>
              <form action={rescheduleReminderAction} className="mt-2 flex flex-wrap items-end gap-2">
                {hidden}
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`rs-${r.id}`} className="text-xs text-muted-foreground">
                    Nowy termin
                  </Label>
                  <Input id={`rs-${r.id}`} type="date" name="dueDate" defaultValue={addDays(today, 1)} required className="w-auto" />
                </div>
                <Button type="submit" variant="outline" size="sm">
                  Zapisz
                </Button>
              </form>
            </details>
            <ConfirmDeleteDialog
              fieldName="reminderId"
              id={r.id}
              action={cancelReminderAction}
              extra={{ back }}
              triggerLabel="anuluj"
              confirmLabel="Anuluj przypomnienie"
              title="Anulować przypomnienie?"
              description="Przypomnienie zniknie z listy. Wiersz zostaje w bazie, żeby powiązane wydarzenie w kalendarzu Google dało się usunąć."
            />
          </>
        )}
      </div>
    </li>
  );
}

/** Formularz dodawania: opóźnienie jak w dotychczasowym formularzu n8n albo dokładna data; re-connect = stałe 3 tygodnie. */
export function AddReminderForm({ contactId, back }: { contactId: string; back: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Dodaj przypomnienie</summary>
      <form action={createReminderAction} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="back" value={back} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`dn-${contactId}`}>Za ile</Label>
          <div className="flex gap-2">
            <Input id={`dn-${contactId}`} name="delayNumber" type="number" min={1} max={3650} defaultValue={2} className="w-24" />
            <NativeSelect name="delayUnit" defaultValue="weeks" aria-label="Jednostka">
              <NativeSelectOption value="days">dni</NativeSelectOption>
              <NativeSelectOption value="weeks">tygodni</NativeSelectOption>
              <NativeSelectOption value="months">miesięcy</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`dd-${contactId}`}>albo dokładna data (ma pierwszeństwo)</Label>
          <Input id={`dd-${contactId}`} name="dueDate" type="date" />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`nt-${contactId}`}>Notatka (np. „umówić BP”, „AYO?”)</Label>
          <Textarea id={`nt-${contactId}`} name="note" rows={2} maxLength={2000} />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" name="kind" value="REMINDER">
            Dodaj przypomnienie
          </Button>
          <Button type="submit" name="kind" value="RECONNECT" variant="outline" title="Stałe 3 tygodnie: tyle LinkedIn każe czekać z ponownym zaproszeniem">
            Re-connect za {RECONNECT_DAYS / 7} tyg.
          </Button>
        </div>
      </form>
    </details>
  );
}
