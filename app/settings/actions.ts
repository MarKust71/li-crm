"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { logActivity } from "@/lib/activity-log";
import { requestManualSync, requestNotifyTest, setIntervalMinutes, setNotifySettings, setTimeSettings } from "@/lib/settings";

export async function saveIntervalAction(formData: FormData) {
  await requireAccess();
  const mode = formData.get("mode");
  let minutes: number;
  if (mode === "off") minutes = -1;
  else if (mode === "manual") minutes = 0;
  else minutes = Number(formData.get("minutes"));
  const ok = await setIntervalMinutes(minutes);
  if (ok) {
    const label = minutes === -1 ? "wyłączona" : minutes === 0 ? "tylko ręcznie" : `co ${minutes} min`;
    await logActivity({ source: "UI", action: "settings.sync_interval", summary: `Synchronizacja kalendarza: ${label}`, details: { minutes } });
  }
  revalidatePath("/settings");
  redirect(ok ? "/settings?saved=1" : "/settings?error=interval");
}

export async function syncNowAction() {
  await requireAccess();
  await requestManualSync();
  await logActivity({ source: "UI", action: "settings.sync_now", summary: "Zażądano synchronizacji kalendarza" });
  revalidatePath("/settings");
  redirect("/settings?requested=1");
}

export async function saveNotifyAction(formData: FormData) {
  await requireAccess();
  const hourRaw = formData.get("digestHour");
  const leadRaw = formData.get("lead");
  const digestHour = hourRaw === "off" ? -1 : Number(hourRaw);
  const ok = await setNotifySettings({
    digestHour,
    meetingLeadMinutes: Number(leadRaw),
    errorAlerts: formData.get("errorAlerts") === "on",
  });
  if (ok) {
    await logActivity({
      source: "UI",
      action: "settings.notify",
      summary: "Zmieniono ustawienia powiadomień Telegram",
      details: { digestHour, meetingLeadMinutes: Number(leadRaw), errorAlerts: formData.get("errorAlerts") === "on" },
    });
  }
  revalidatePath("/settings");
  redirect(ok ? "/settings?notifySaved=1" : "/settings?error=notify");
}

export async function notifyTestAction() {
  await requireAccess();
  await requestNotifyTest();
  await logActivity({ source: "UI", action: "settings.notify_test", summary: "Zażądano wiadomości testowej Telegram" });
  revalidatePath("/settings");
  redirect("/settings?notifyTest=1");
}

export async function saveTimeSettingsAction(formData: FormData) {
  await requireAccess();
  const idleMinutes = Number(formData.get("idleMinutes"));
  const pauseMinutes = Number(formData.get("pauseMinutes"));
  const suggestStart = formData.get("suggestStart") === "on";
  const ok = await setTimeSettings({ idleMinutes, pauseMinutes, suggestStart });
  if (ok) {
    await logActivity({
      source: "UI",
      action: "settings.time",
      summary: `Czas pracy: próg pauzy ${pauseMinutes > 0 ? `${pauseMinutes} min` : "wyłączony"}, próg zakończenia ${idleMinutes > 0 ? `${idleMinutes} min` : "wyłączony"}, podpowiedź włączenia ${suggestStart ? "włączona" : "wyłączona"}`,
      details: { idleMinutes, pauseMinutes, suggestStart },
    });
  }
  revalidatePath("/settings");
  redirect(ok ? "/settings?timeSaved=1" : "/settings?error=time");
}

/** "Synchronizuj kalendarz" z paska u góry strony: jak w Ustawieniach, ale bez przekierowania (zostajesz na bieżącej stronie). */
export async function syncNowFromBarAction() {
  await requireAccess();
  await requestManualSync();
  await logActivity({ source: "UI", action: "settings.sync_now", summary: "Zażądano synchronizacji kalendarza (z paska)" });
  revalidatePath("/", "layout");
}
