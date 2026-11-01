import { useEffect, useState } from "react";
import { command, isDesktop } from "../../hooks/useSnapshot";

export function useNotificationAvailability(id: string): { bubble: boolean | null; permission: string } {
  const [value, setValue] = useState<{ bubble: boolean | null; permission: string }>({
    bubble: null,
    permission: "unknown",
  });
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let bubbleSequence = 0;
    let permissionSequence = 0;
    setValue({ bubble: null, permission: "unknown" });
    async function refreshBubble(): Promise<void> {
      const current = ++bubbleSequence;
      const bubble = await command<boolean>("get_planner_bubble_available", { id }).catch(() => null);
      if (active && bubbleSequence === current) setValue((previous) => ({ ...previous, bubble }));
    }
    async function refreshPermission(): Promise<void> {
      const current = ++permissionSequence;
      const permission = await command<string>("get_planner_notification_permission").catch(() => "unknown");
      if (active && permissionSequence === current) setValue((previous) => ({ ...previous, permission }));
    }
    function refresh(): void {
      void refreshBubble();
      void refreshPermission();
    }
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(() => void refreshBubble(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [id]);
  return value;
}

export function notificationUnavailable(channel: string, bubble: boolean | null, permission: string): boolean {
  const bubbleUnavailable = bubble === false;
  const osUnavailable = channel === "bubble" || ["denied", "prompt"].includes(permission);
  return bubbleUnavailable && osUnavailable;
}
