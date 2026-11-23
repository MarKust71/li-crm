import { SIGNATURE_PHOTO_B64 } from "./signature-photo";

// Czysta logika szkicu e-maila po umówieniu BOM (bez bazy i sieci). Warstwa bazy: lib/bom-draft.ts.
// Aplikacja składa cały mail (treść, podpis ze zdjęciem, MIME base64url); szkic w Gmailu tworzy n8n (workflow "li-crm: szkic e-maila po umówieniu BOM", wywoływany webhookiem z aplikacji).

const WEEKDAY = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
const WEEKDAY_ACC = ["w niedzielę", "w poniedziałek", "we wtorek", "w środę", "w czwartek", "w piątek", "w sobotę"];
const MONTH_GEN = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function warsaw(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: p.hour, minute: p.minute, dow };
}

/** Klucz idempotencji (SentNotification): jeden szkic na umówienie i termin; zmiana terminu daje nowy szkic z nową datą. */
export const bomDraftKey = (eventId: string | number, scheduledAt: Date) => `bomdraft:${eventId}:${scheduledAt.getTime()}`;

export type BomDraftInput = { scheduledAt: Date; salutation: string | null; link: string };
export type BomDraft = { subject: string; html: string; when: string };

const SIGNATURE =
  '<table cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #aaaaaa;border-bottom:1px solid #aaaaaa;margin-top:8px;"><tr>' +
  '<td style="padding:8px 8px 8px 0;vertical-align:middle;"><img src="cid:signature-photo" width="80" height="80" alt="Marek Kustosz" style="display:block;width:80px;height:80px;"></td>' +
  '<td style="padding:8px 0;vertical-align:middle;font-family:Verdana,Arial,sans-serif;font-size:10px;line-height:1.6;color:#000000;">' +
  '<div style="font-size:12px;"><b>Marek Kustosz</b></div>' +
  '<div><a href="mailto:marek.kustosz@gmail.com" style="color:#0000e9;">marek.kustosz@gmail.com</a></div>' +
  "<div>+48 600 414149</div>" +
  "<div>e-Doręczenia: AE:PL-42008-29453-JGCBR-10</div>" +
  '<div><a href="https://www.instagram.com/marek.kustosz/">Instagram</a> &middot; <a href="https://www.facebook.com/markust71/">Facebook</a> &middot; <a href="https://www.linkedin.com/in/mkustosz/">LinkedIn</a> &middot; <a href="https://wa.me/48600414149">WhatsApp</a> &middot; <a href="skype:markust71?call">Skype</a></div>' +
  "</td></tr></table>";

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

/** Wiadomość MIME (multipart/related: HTML + zdjęcie inline) w base64url, gotowa do pola `raw` szkicu Gmaila. */
export function buildRawMime(to: string, subject: string, html: string): string {
  const b = `rel_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const parts = [
    "MIME-Version: 1.0",
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    `Content-Type: multipart/related; boundary="${b}"`,
    "",
    `--${b}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(html, "utf8").toString("base64")),
    `--${b}`,
    'Content-Type: image/jpeg; name="marek-kustosz.jpg"',
    "Content-Transfer-Encoding: base64",
    "Content-ID: <signature-photo>",
    'Content-Disposition: inline; filename="marek-kustosz.jpg"',
    "",
    wrap76(SIGNATURE_PHOTO_B64),
    `--${b}--`,
    "",
  ];
  return Buffer.from(parts.join("\r\n"), "utf8").toString("base64url");
}

/** Temat i treść (HTML bez podpisu) jak w przypomnieniu dzień przed spotkaniem, ale bez słowa „jutro". */
export function buildBomDraft(input: BomDraftInput): BomDraft {
  const w = warsaw(input.scheduledAt);
  const datePl = `${w.day} ${MONTH_GEN[w.month - 1]} ${w.year} r.`;
  const time = `${w.hour}:${w.minute}`;
  const when = `${WEEKDAY[w.dow]}, ${datePl}, ${time}`;

  const zwrot = (input.salutation ?? "").trim();
  const male = /^pan(ie)?\b/i.test(zwrot);
  const youGen = male ? "Pana" : "Pani";
  const youAcc = male ? "Pana" : "Panią";
  const roomLabel = /zoom\.us|mydmb\.pl\/c\/.*zoom/i.test(input.link) ? "pokoju Zoom" : "spotkania online";

  const p = (s: string) => `<p>${s}</p>`;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;">' +
    p(`<b>${esc(zwrot ? `Dzień dobry, ${zwrot} 😊` : "Dzień dobry 😊")}</b>`) +
    p(`Poniżej podaję link do ${roomLabel}, w którym odbędzie się nasza krótka rozmowa:<br><a href="${esc(input.link)}">${esc(input.link)}</a>`) +
    p(esc(`Szanuję ${youGen} czas i dołożę wszelkich starań, żeby pojawić się najpóźniej o ustalonej godzinie.`)) +
    p(esc(`Jeśli dojdzie do czegoś naprawdę nieprzewidzianego, co uniemożliwi mi odbycie naszej rozmowy w ustalonym terminie, poinformuję ${youAcc} o tym możliwie najwcześniej korzystając z udostępnionych mi informacji kontaktowych.`)) +
    p(esc(`Naturalnie, jeśli z ${youGen} strony coś podobnego się wydarzy, krótka informacja (e-mail, WhatsApp) bardzo mi pomoże.`)) +
    p("<b>Będę wdzięczny za krótkie potwierdzenie, że wiadomość dotarła i link działa.</b>") +
    p(`Dziękuję i do zobaczenia <b><u>${WEEKDAY_ACC[w.dow]}, ${datePl}, o godz. ${time}</u></b> 😊`) +
    p("Marek") +
    SIGNATURE +
    "</div>";

  return { subject: `Spotkanie ${WEEKDAY[w.dow]}, ${datePl}, godz. ${time}`, html, when };
}
