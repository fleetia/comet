import { Button, Checkbox, FormField, TextInput } from "@comet/ui";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { canOpenNotificationSettings, notificationSettingsText, openSystemSettings } from "../../systemSettings";
import { record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as c from "../../common.css";
import * as s from "../tools.css";
import * as a from "./plannerAlerts.css";

function savedSettings(data: DataRecord): DataRecord {
  return {
    enabled: data.enabled === true,
    characterEnabled: data.characterEnabled !== false,
    osEnabled: data.osEnabled === true,
    soundEnabled: data.soundEnabled === true,
    leadMinutes: typeof data.leadMinutes === "number" ? data.leadMinutes : 10,
    includeAllDay: data.includeAllDay === true,
    moodDayStart: data.moodDayStart === true,
    moodFocusStart: data.moodFocusStart === true,
    moodBreak: data.moodBreak === true,
    moodDayEnd: data.moodDayEnd === true,
    dayStart: text(data.dayStart) || "09:00",
    dayEnd: text(data.dayEnd) || "21:00",
  };
}

export function PlannerAlerts({
  data,
  act,
  onDirtyChange,
}: {
  data: DataRecord;
  act: ToolAction;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const savedValues = savedSettings(data);
  const [draft, setDraft] = useState<DataRecord | null>(null);
  const values = draft ?? savedValues;
  const dirty = JSON.stringify(values) !== JSON.stringify(savedValues);
  const [saved, setSaved] = useState(false);
  const [savedOsEnabled, setSavedOsEnabled] = useState(false);
  const [permission, setPermission] = useState("unknown");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const permissionRequest = useRef(0);
  const permissionPending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let active = true;
    function refreshPermission(): void {
      if (permissionPending.current) return;
      const request = ++permissionRequest.current;
      void command<string>("get_planner_notification_permission")
      .then((value) => {
        if (active && request === permissionRequest.current) {
          setPermission(value);
        }
      })
      .catch(() => {
        if (active && request === permissionRequest.current) {
          setPermission("unknown");
        }
      });
    }
    refreshPermission();
    window.addEventListener("focus", refreshPermission);
    return () => {
      active = false;
      permissionRequest.current += 1;
      window.removeEventListener("focus", refreshPermission);
    };
  }, []);
  function change(patch: DataRecord): void {
    setDraft({ ...values, ...patch });
    setSaved(false);
  }
  async function notification(action: "permission" | "preview"): Promise<void> {
    if (!isDesktop()) {
      setError("OS 알림은 데스크톱 앱에서 사용할 수 있어요.");
      return;
    }
    setPermissionBusy(true);
    permissionPending.current = true;
    setError(null);
    setNotice("");
    try {
      if (action === "permission") {
        const request = ++permissionRequest.current;
        const result = await command<string>("request_planner_notification_permission");
        if (request === permissionRequest.current) setPermission(result);
      } else {
        await command("preview_planner_notification");
        setNotice("OS에 미리보기 알림을 보냈어요. 표시 방식은 시스템 알림 설정을 따릅니다.");
      }
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      permissionPending.current = false;
      setPermissionBusy(false);
    }
  }
  return (
    <section className={s.section} aria-label="일정과 생활 알림">
      <h2 className={s.sectionTitle}>일정과 생활 알림</h2>
      <form
        className={s.composer}
        onSubmit={async (event) => {
          event.preventDefault();
          if (await act("configure-alerts", values)) {
            setSavedOsEnabled(values.osEnabled === true);
            setDraft(null);
            setSaved(true);
          }
        }}
      >
        <Checkbox
          checked={values.enabled === true}
          onChange={(event) => change({ enabled: event.target.checked })}
          label="일정·할 일 기한 알림 켜기"
        />
        <div className={a.columns}>
          <div className={a.group}>
            <Checkbox
              checked={values.characterEnabled === true}
              onChange={(event) => change({ characterEnabled: event.target.checked })}
              label="캐릭터 말풍선"
            />
            <Checkbox
              checked={values.osEnabled === true}
              onChange={(event) => {
                const enabled = event.target.checked;
                change({ osEnabled: enabled });
                if (enabled) {
                  void notification("permission");
                }
              }}
              label="OS 알림"
            />
            <Checkbox
              checked={values.soundEnabled === true}
              onChange={(event) => change({ soundEnabled: event.target.checked })}
              label="OS 알림 소리"
            />
            <p className={c.quiet}>말풍선을 닫거나 캐릭터를 숨겨도 OS 알림 설정은 유지돼요.</p>
          </div>
          <div className={a.group}>
            <FormField className={c.field} label="몇 분 전에 알릴까요?" required>
              <TextInput
                fill
                type="number"
                min="0"
                max="120"
                value={Number(values.leadMinutes)}
                onChange={(event) => change({ leadMinutes: Number(event.target.value) })}
              />
            </FormField>
            <Checkbox
              checked={values.includeAllDay === true}
              onChange={(event) => change({ includeAllDay: event.target.checked })}
              label="종일 일정·날짜 기한도 알림"
            />
            <p className={c.quiet}>날짜만 있으면 오전 9시를 기준으로 알립니다.</p>
          </div>
          <div className={a.group}>
            <p className={c.quiet}>
              조용한 시간은 설정 → 대화에서 함께 정해요. 그동안 일상 인사는 쉬고, 타이머 종료와
              일정·기한 알림은 계속 알려 드려요.
            </p>
          </div>
        </div>
        <div className={a.permission}>
          <span>
            OS 알림:{" "}
            {
              {
                granted: "허용됨",
                denied: notificationSettingsText(),
                prompt: "권한 요청 전",
                system: "시스템 알림 설정을 따름",
                unknown: "확인 필요",
              }[permission]
            }
          </span>
          {isDesktop() && permission === "denied" && canOpenNotificationSettings() && (
            <Button type="button" variant="ghost" onClick={() => void openSystemSettings("notifications").catch((cause: unknown) => setError(errorText(cause)))}>
              시스템 설정 열기
            </Button>
          )}
          {permission !== "denied" && <Button
            type="button"
            variant="ghost"
            disabled={permissionBusy}
            onClick={() => void notification("permission")}
          >
            OS 알림 권한 요청
          </Button>}
          <Button
            type="button"
            variant="ghost"
            disabled={permissionBusy}
            onClick={() => void notification("preview")}
          >
            OS 알림 미리보기
          </Button>
        </div>
        <h3 className={a.heading}>무드메이커</h3>
        <div className={a.columns}>
          <div className={a.group}>
            <Checkbox
              checked={values.moodDayStart === true}
              onChange={(event) => change({ moodDayStart: event.target.checked })}
              label="하루 시작 인사"
            />
            <FormField className={c.field} label="하루 시작 시각" required>
              <TextInput
                fill
                type="time"
                value={text(values.dayStart)}
                onChange={(event) => change({ dayStart: event.target.value })}
              />
            </FormField>
          </div>
          <div className={a.group}>
            <Checkbox
              checked={values.moodFocusStart === true}
              onChange={(event) => change({ moodFocusStart: event.target.checked })}
              label="집중 시작 응원"
            />
            <Checkbox
              checked={values.moodBreak === true}
              onChange={(event) => change({ moodBreak: event.target.checked })}
              label="집중 종료·쉬기 제안"
            />
          </div>
          <div className={a.group}>
            <Checkbox
              checked={values.moodDayEnd === true}
              onChange={(event) => change({ moodDayEnd: event.target.checked })}
              label="하루 마무리 제안"
            />
            <FormField className={c.field} label="하루 마무리 시각" required>
              <TextInput
                fill
                type="time"
                value={text(values.dayEnd)}
                onChange={(event) => change({ dayEnd: event.target.value })}
              />
            </FormField>
          </div>
        </div>
        <p className={c.quiet}>
          캐릭터 말풍선으로 가끔 이야기해요. 하루 시작·마무리는 각각 한 번, 집중 인사는 10분 이상
          간격을 둡니다. 놓친 알림을 몰아서 보내지 않아요.
        </p>
        <div className={s.row}>
          <Button type="submit" variant="ghost" disabled={!dirty}>
            알림 설정 저장
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setSaved(false);
              }}
            >
              알림 변경 취소
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => void act("preview-alert")}>
            캐릭터 인사 미리보기
          </Button>
        </div>
        {saved && <p role="status">알림 설정을 저장했어요.</p>}
        {saved && savedOsEnabled && permission === "denied" && (
          <p role="alert" className={c.error}>OS 알림 권한이 꺼져 있어 알림이 표시되지 않을 수 있어요.</p>
        )}
        {notice && <p role="status">{notice}</p>}
        <DeliveryError error={text(record(data.alertState).lastDeliveryError)} act={act} />
        {error && (
          <p role="alert" className={c.error}>
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function DeliveryError({
  error,
  act,
  widget,
}: {
  error: string;
  act: ToolAction;
  widget?: WidgetView;
}): ReactElement | null {
  const [settingsError, setSettingsError] = useState("");
  if (!error) {
    return null;
  }
  return (
    <>
      <p role="alert" className={c.error}>{error}</p>
      <div className={s.row}>
        <Button type="button" variant="ghost" onClick={() => void act("clear-notification-error", {}, widget)}>
          알림 오류 닫기
        </Button>
        {isDesktop() && canOpenNotificationSettings() && (
          <Button type="button" variant="ghost" onClick={() => void openSystemSettings("notifications").catch((cause: unknown) => setSettingsError(errorText(cause)))}>
            시스템 설정 열기
          </Button>
        )}
      </div>
      {settingsError && <p role="alert" className={c.error}>{settingsError}</p>}
    </>
  );
}

export function PlannerAlertNotice({
  widget,
  act,
}: {
  widget: WidgetView;
  act: ToolAction;
}): ReactElement | null {
  const state = record(record(widget.data).alertState);
  const deliveryError = text(state.lastDeliveryError);
  const last = record(state.lastNotification);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const observed = typeof last.observedAt === "number" ? last.observedAt : 0;
  const canSnooze = rows(last.targets).some((target) =>
    ["calendar", "todo", "focus-event"].includes(text(target.kind)),
  );
  const snoozed = typeof state.snoozeAt === "number" && state.snoozeAt > now;
  const recent = observed <= now && now - observed <= 3_600_000 && dismissed !== observed;
  if (!recent && !deliveryError) {
    return null;
  }
  return (
    <aside className={a.notice} aria-label="생활 알림">
      <DeliveryError error={deliveryError} act={act} widget={widget} />
      {recent && <>
        <p>{text(last.text)}</p>
        <div className={s.row}>
          {canSnooze && <Button
            variant="ghost"
            disabled={snoozed}
            onClick={() => void act("snooze-alert", {}, widget)}
          >
            {snoozed ? "다시 알림 예약됨" : "10분 뒤 다시 알림"}
          </Button>}
          <Button variant="ghost" onClick={() => setDismissed(observed)}>
            이 알림 닫기
          </Button>
          {canSnooze && snoozed && <span className={c.quiet}>기한은 그대로 유지됩니다.</span>}
        </div>
      </>}
    </aside>
  );
}
