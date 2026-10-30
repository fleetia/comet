import { command } from "./hooks/useSnapshot";

export function notificationSettingsText(): string {
  if (/Win/i.test(navigator.platform)) {
    return "꺼짐 · Windows 설정 → 시스템 → 알림에서 켜요";
  }
  if (/Mac/i.test(navigator.platform)) {
    return "꺼짐 · 시스템 설정 → 알림에서 켜요";
  }
  return "꺼짐 · 시스템 설정에서 켜요";
}

export function canOpenNotificationSettings(): boolean {
  return /Mac|Win/i.test(navigator.platform);
}

export function openSystemSettings(page: "notifications" | "appleIntelligence" | "calendar"): Promise<void> {
  return command("open_system_settings", { page });
}
