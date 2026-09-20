import { Button, Checkbox, FormField, TextField } from "@fleetia/lagrange";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { record, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";
import * as a from "./plannerAlerts.css";

function useNotificationError(): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let active = true;
    let cleanup: (() => void) | undefined;
    void listen<string>("planner-notification-error", (event) => {
      if (active) {
        setError(event.payload);
      }
    })
      .then((stop) => {
        if (active) {
          cleanup = stop;
        } else {
          stop();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);
  return error;
}

function savedSettings(data: DataRecord): DataRecord {
  return {
    enabled: data.enabled === true,
    characterEnabled: data.characterEnabled !== false,
    osEnabled: data.osEnabled === true,
    leadMinutes: typeof data.leadMinutes === "number" ? data.leadMinutes : 10,
    includeAllDay: data.includeAllDay === true,
    quietStart: text(data.quietStart) || "22:00",
    quietEnd: text(data.quietEnd) || "08:00",
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
  const [permission, setPermission] = useState("unknown");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deliveryError = useNotificationError();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let active = true;
    void command<string>("get_planner_notification_permission")
      .then((value) => {
        if (active) {
          setPermission(value);
        }
      })
      .catch(() => {
        if (active) {
          setPermission("unknown");
        }
      });
    return () => {
      active = false;
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
    setError(null);
    setNotice("");
    try {
      if (action === "permission") {
        setPermission(await command<string>("request_planner_notification_permission"));
      } else {
        await command("preview_planner_notification");
        setNotice("OS에 미리보기 알림을 보냈어요. 표시 방식은 시스템 알림 설정을 따릅니다.");
      }
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
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
            setDraft(null);
            setSaved(true);
          }
        }}
      >
        <Checkbox
          checked={values.enabled === true}
          onChange={(event) => change({ enabled: event.target.checked })}
        >
          일정·할 일 기한 알림 켜기
        </Checkbox>
        <div className={a.columns}>
          <div className={a.group}>
            <Checkbox
              checked={values.characterEnabled === true}
              onChange={(event) => change({ characterEnabled: event.target.checked })}
            >
              캐릭터 말풍선
            </Checkbox>
            <Checkbox
              checked={values.osEnabled === true}
              onChange={(event) => change({ osEnabled: event.target.checked })}
            >
              OS 알림
            </Checkbox>
            <p className={c.quiet}>말풍선을 닫거나 캐릭터를 숨겨도 OS 알림 설정은 유지돼요.</p>
          </div>
          <div className={a.group}>
            <FormField className={c.field} label="몇 분 전에 알릴까요?" required>
              <TextField
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
            >
              종일 일정·날짜 기한도 알림
            </Checkbox>
            <p className={c.quiet}>날짜만 있으면 오전 9시를 기준으로 알립니다.</p>
          </div>
          <div className={a.group}>
            <FormField className={c.field} label="조용한 시간 시작" required>
              <TextField
                type="time"
                value={text(values.quietStart)}
                onChange={(event) => change({ quietStart: event.target.value })}
              />
            </FormField>
            <FormField className={c.field} label="조용한 시간 끝" required>
              <TextField
                type="time"
                value={text(values.quietEnd)}
                onChange={(event) => change({ quietEnd: event.target.value })}
              />
            </FormField>
            <p className={c.quiet}>기기 시간대 기준 · 시작과 끝이 같으면 제한 없음</p>
          </div>
        </div>
        <div className={a.permission}>
          <span>
            OS 알림:{" "}
            {
              {
                granted: "허용됨",
                denied: "꺼짐 · 시스템 설정에서 변경",
                prompt: "권한 요청 전",
                system: "시스템 알림 설정을 따름",
                unknown: "확인 필요",
              }[permission]
            }
          </span>
          <Button
            type="button"
            variant="quiet"
            disabled={permissionBusy}
            onClick={() => void notification("permission")}
          >
            OS 알림 권한 요청
          </Button>
          <Button
            type="button"
            variant="quiet"
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
            >
              하루 시작 인사
            </Checkbox>
            <FormField className={c.field} label="하루 시작 시각" required>
              <TextField
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
            >
              집중 시작 응원
            </Checkbox>
            <Checkbox
              checked={values.moodBreak === true}
              onChange={(event) => change({ moodBreak: event.target.checked })}
            >
              집중 종료·쉬기 제안
            </Checkbox>
          </div>
          <div className={a.group}>
            <Checkbox
              checked={values.moodDayEnd === true}
              onChange={(event) => change({ moodDayEnd: event.target.checked })}
            >
              하루 마무리 제안
            </Checkbox>
            <FormField className={c.field} label="하루 마무리 시각" required>
              <TextField
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
          <Button type="submit" variant="secondary" disabled={!dirty}>
            알림 설정 저장
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setDraft(null);
                setSaved(false);
              }}
            >
              알림 변경 취소
            </Button>
          )}
          <Button type="button" variant="quiet" onClick={() => void act("preview-alert")}>
            캐릭터 인사 미리보기
          </Button>
          <Button type="button" variant="quiet" onClick={() => void act("mute-alerts")}>
            생활 알림 1시간 쉬기
          </Button>
        </div>
        {saved && <p role="status">알림 설정을 저장했어요.</p>}
        {notice && <p role="status">{notice}</p>}
        {(error || deliveryError) && (
          <p role="alert" className={c.error}>
            {error || deliveryError}
          </p>
        )}
      </form>
    </section>
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
  const deliveryError = useNotificationError();
  const last = record(state.lastNotification);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const observed = typeof last.observedAt === "number" ? last.observedAt : 0;
  const muted = typeof state.mutedUntil === "number" && state.mutedUntil > now;
  const snoozed = typeof state.snoozeAt === "number" && state.snoozeAt > now;
  const recent = observed <= now && now - observed <= 3_600_000 && dismissed !== observed;
  if (!muted && !recent && !deliveryError) {
    return null;
  }
  if (!muted && !recent) {
    return (
      <aside className={a.notice} aria-label="생활 알림">
        <p role="alert" className={c.error}>
          {deliveryError}
        </p>
      </aside>
    );
  }
  return (
    <aside className={a.notice} aria-label="생활 알림">
      {deliveryError && (
        <p role="alert" className={c.error}>
          {deliveryError}
        </p>
      )}
      <p>
        {muted
          ? `생활 알림을 ${new Date(Number(state.mutedUntil)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}까지 쉬어요.`
          : text(last.text)}
      </p>
      <div className={s.row}>
        {muted ? (
          <Button variant="quiet" onClick={() => void act("unmute-alerts", {}, widget)}>
            지금 다시 켜기
          </Button>
        ) : (
          <>
            <Button
              variant="quiet"
              disabled={snoozed}
              onClick={() => void act("snooze-alert", {}, widget)}
            >
              {snoozed ? "다시 알림 예약됨" : "10분 뒤 다시 알림"}
            </Button>
            <Button variant="quiet" onClick={() => void act("mute-alerts", {}, widget)}>
              1시간 쉬기
            </Button>
            <Button variant="quiet" onClick={() => setDismissed(observed)}>
              이 알림 닫기
            </Button>
          </>
        )}
        {snoozed && <span className={c.quiet}>기한은 그대로 유지됩니다.</span>}
      </div>
    </aside>
  );
}
