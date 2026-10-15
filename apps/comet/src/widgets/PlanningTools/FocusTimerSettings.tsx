import { Button, Checkbox, Dialog, FormField, Select, TextField } from "../../ui";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { SettingControlRow, Stepper, Switch } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { number, record, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as s from "./FocusTimer.css";

export function FocusTimerSettings({
  widget,
  calendar,
  act,
  onClose,
  onDirtyChange,
  onBusyChange,
  embedded = false,
}: {
  widget: WidgetView;
  calendar?: WidgetView;
  act: ToolAction;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  embedded?: boolean;
}): ReactElement {
  const [rest, setRest] = useState(() =>
    String((number(record(record(widget.data).settings).restDurationMs) || 300000) / 60000),
  );
  const reminders = record(record(calendar?.data).reminders);
  const savedLead = typeof reminders.leadMinutes === "number" ? reminders.leadMinutes : 10;
  const [lead, setLead] = useState(() => {
    if (reminders.enabled !== true) return "off";
    const saved = savedLead;
    return [0, 5, 10, 15, 30].includes(saved) ? String(saved) : "custom";
  });
  const [custom, setCustom] = useState(() => String(savedLead));
  const [osEnabled, setOsEnabled] = useState(reminders.osEnabled === true);
  const [soundEnabled, setSoundEnabled] = useState(reminders.soundEnabled === true);
  const [moodFocusStart, setMoodFocusStart] = useState(reminders.moodFocusStart === true);
  const [permission, setPermission] = useState("unknown");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState({ rest: false, alerts: false, permission: false });
  const locks = useRef({ rest: false, alerts: false, permission: false });
  const busy = pending.rest || pending.alerts || pending.permission;
  const saving = pending.rest || pending.alerts;
  const savedRest = (number(record(record(widget.data).settings).restDurationMs) || 300000) / 60000;
  const [restBase, setRestBase] = useState(savedRest);
  const [alertsBase, setAlertsBase] = useState(reminders);
  const restSavedRevision = useRef<number | null>(null);
  const alertsSavedRevision = useRef<number | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const permissionRequest = useRef(0);
  const latest = useRef({ widget, calendar });
  latest.current = { widget, calendar };
  const target = useRef(`${widget.id}:${calendar?.id ?? ""}`);
  const scope = `${widget.id}:${calendar?.id ?? ""}`;
  if (target.current !== scope) {
    target.current = scope;
    generation.current += 1;
  }
  const [confirmClose, setConfirmClose] = useState(false);
  const report = useRef({ onDirtyChange, onBusyChange });
  report.current = { onDirtyChange, onBusyChange };
  const restDirty = Number(rest) !== restBase || !rest.trim();
  const alertsLead = lead === "custom" ? Number(custom) : Number(lead);
  const baseLead = typeof alertsBase.leadMinutes === "number" ? alertsBase.leadMinutes : 10;
  const alertsDirty =
    (lead !== "off") !== (alertsBase.enabled === true) ||
    (lead !== "off" && alertsLead !== baseLead) ||
    osEnabled !== (alertsBase.osEnabled === true) ||
    soundEnabled !== (alertsBase.soundEnabled === true) ||
    (embedded && moodFocusStart !== (alertsBase.moodFocusStart === true));
  const restConflict =
    restDirty &&
    savedRest !== restBase &&
    (restSavedRevision.current === null || widget.revision > restSavedRevision.current);
  const alertKey = (value: DataRecord): string =>
    JSON.stringify([
      value.enabled === true,
      typeof value.leadMinutes === "number" ? value.leadMinutes : 10,
      value.osEnabled === true,
      value.soundEnabled === true,
      ...(embedded ? [value.moodFocusStart === true] : []),
    ]);
  const alertsConflict =
    alertsDirty &&
    alertKey(reminders) !== alertKey(alertsBase) &&
    (alertsSavedRevision.current === null ||
      (calendar?.revision ?? 0) > alertsSavedRevision.current);
  function loadAlerts(value: DataRecord): void {
    const minutes = typeof value.leadMinutes === "number" ? value.leadMinutes : 10;
    setLead(
      value.enabled === true
        ? [0, 5, 10, 15, 30].includes(minutes)
          ? String(minutes)
          : "custom"
        : "off",
    );
    setCustom(String(minutes));
    setOsEnabled(value.osEnabled === true);
    setSoundEnabled(value.soundEnabled === true);
    setMoodFocusStart(value.moodFocusStart === true);
    setAlertsBase(value);
  }
  useEffect(() => {
    restSavedRevision.current = null;
    alertsSavedRevision.current = null;
    setRest(String(savedRest));
    setRestBase(savedRest);
    loadAlerts(reminders);
    locks.current = { rest: false, alerts: false, permission: false };
    setPending({ rest: false, alerts: false, permission: false });
    setError("");
    setNotice("");
  }, [scope]);
  useEffect(() => {
    if (
      !restDirty &&
      !locks.current.rest &&
      (restSavedRevision.current === null || widget.revision > restSavedRevision.current)
    ) {
      restSavedRevision.current = null;
      setRest(String(savedRest));
      setRestBase(savedRest);
    }
  }, [widget.revision, savedRest, restDirty]);
  useEffect(() => {
    if (
      !alertsDirty &&
      !locks.current.alerts &&
      (alertsSavedRevision.current === null ||
        (calendar?.revision ?? 0) > alertsSavedRevision.current)
    ) {
      alertsSavedRevision.current = null;
      loadAlerts(reminders);
    }
  }, [calendar?.revision, alertKey(reminders), alertsDirty]);
  useEffect(() => {
    report.current.onDirtyChange?.(restDirty || Boolean(calendar && alertsDirty));
    report.current.onBusyChange?.(saving);
  }, [restDirty, alertsDirty, calendar, saving]);
  useEffect(() => {
    mounted.current = true;
    const version = generation.current;
    const request = ++permissionRequest.current;
    if (isDesktop())
      void command<string>("get_planner_notification_permission")
        .then((value) => {
          if (
            mounted.current &&
            version === generation.current &&
            request === permissionRequest.current
          )
            setPermission(value);
        })
        .catch(() => {});
    return () => {
      mounted.current = false;
      generation.current += 1;
      report.current.onDirtyChange?.(false);
      report.current.onBusyChange?.(false);
    };
  }, []);
  async function requestPermission(): Promise<void> {
    if (locks.current.permission) return;
    locks.current.permission = true;
    const version = generation.current;
    const request = ++permissionRequest.current;
    setPending((value) => ({ ...value, permission: true }));
    setError("");
    try {
      const value = await command<string>("request_planner_notification_permission");
      if (
        mounted.current &&
        version === generation.current &&
        request === permissionRequest.current
      )
        setPermission(value);
    } catch (cause: unknown) {
      if (mounted.current && version === generation.current) setError(errorText(cause));
    } finally {
      if (version === generation.current) {
        locks.current.permission = false;
        if (mounted.current) setPending((value) => ({ ...value, permission: false }));
      }
    }
  }
  async function save(scope: "all" | "rest" | "alerts" = "all"): Promise<void> {
    if (locks.current.rest || locks.current.alerts) return;
    const restMinutes = Number(rest);
    const leadMinutes = lead === "custom" ? Number(custom) : Number(lead);
    if (
      scope !== "alerts" &&
      (!Number.isFinite(restMinutes) || restMinutes < 1 || restMinutes > 180)
    ) {
      setError("휴식 시간은 1~180분으로 입력해 주세요.");
      return;
    }
    if (
      scope !== "rest" &&
      lead !== "off" &&
      ((lead === "custom" && !custom.trim()) ||
        !Number.isInteger(leadMinutes) ||
        leadMinutes < 0 ||
        leadMinutes > 120)
    ) {
      setError("일정 알람은 시작 시각부터 120분 전까지 설정할 수 있어요.");
      return;
    }
    if ((scope !== "alerts" && restConflict) || (scope !== "rest" && alertsConflict)) {
      setError("다른 곳에서 설정이 바뀌었어요. 최신 저장값을 확인한 뒤 다시 입력해 주세요.");
      return;
    }
    const version = generation.current;
    const restTarget = widget;
    const alertTarget = calendar;
    let restSaved = false;
    locks.current.rest = scope !== "alerts";
    locks.current.alerts = scope !== "rest" && Boolean(calendar);
    setPending((value) => ({ ...value, rest: locks.current.rest, alerts: locks.current.alerts }));
    setError("");
    setNotice("");
    try {
      if (scope !== "alerts") {
        const ok = await act(
          "configure-settings",
          { restDurationMs: Math.round(restMinutes * 60000) },
          restTarget,
        );
        if (!mounted.current || version !== generation.current) return;
        if (!ok) {
          setError("휴식 시간을 저장하지 못했어요. 입력은 남아 있어요.");
          return;
        }
        const currentRest =
          (number(record(record(latest.current.widget.data).settings).restDurationMs) || 300000) /
          60000;
        if (latest.current.widget.revision > restTarget.revision && currentRest !== restMinutes) {
          setError("휴식 시간이 다른 곳에서 바뀌었어요. 입력을 확인해 주세요.");
          return;
        }
        restSaved = true;
        restSavedRevision.current = restTarget.revision;
        setRestBase(restMinutes);
        setRest(String(restMinutes));
      }
      if (calendar && scope !== "rest") {
        const input: DataRecord = {
          ...reminders,
          enabled: lead !== "off",
          leadMinutes: lead === "off" ? baseLead : leadMinutes,
          osEnabled,
          soundEnabled,
          ...(embedded ? { moodFocusStart } : {}),
        };
        const ok = await act("configure-alerts", input, alertTarget);
        if (!mounted.current || version !== generation.current) return;
        if (!ok) {
          if (scope === "all")
            setNotice("휴식 시간은 저장했어요. 일정 알람 설정을 다시 저장해 주세요.");
          setError("일정 알림을 저장하지 못했어요. 입력은 남아 있어요.");
          return;
        }
        const currentCalendar = latest.current.calendar;
        if (
          currentCalendar &&
          currentCalendar.revision > alertTarget!.revision &&
          alertKey(record(record(currentCalendar.data).reminders)) !== alertKey(input)
        ) {
          if (restSaved) setNotice("휴식 시간은 저장했어요. 일정 알람 설정을 다시 확인해 주세요.");
          setError("일정 알림이 다른 곳에서 바뀌었어요. 입력을 확인해 주세요.");
          return;
        }
        alertsSavedRevision.current = alertTarget!.revision;
        setAlertsBase(input);
      }
      if (scope === "all") {
        if (embedded) setNotice("설정을 저장했어요.");
        else onClose();
      } else setNotice(scope === "rest" ? "휴식 시간을 저장했어요." : "일정 알림을 저장했어요.");
    } catch (cause: unknown) {
      if (mounted.current && version === generation.current) {
        if (restSaved) setNotice("휴식 시간은 저장했어요. 일정 알람 설정을 다시 저장해 주세요.");
        setError(errorText(cause));
      }
    } finally {
      if (version === generation.current) {
        locks.current.rest = false;
        locks.current.alerts = false;
        if (mounted.current) setPending((value) => ({ ...value, rest: false, alerts: false }));
      }
    }
  }
  const form = (
    <form
      className={s.pane}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {embedded ? (
        <SettingControlRow
          title="기본 휴식 시간"
          description="다음 휴식부터 적용해요"
          control={
            <Stepper
              aria-label="휴식 시간 (분)"
              disabled={busy}
              min={1}
              max={180}
              unit="분"
              value={Number(rest)}
              onValueChange={(minutes) => setRest(String(minutes))}
            />
          }
        />
      ) : (
        <FormField label="휴식 시간 (분)">
          <TextField
            disabled={busy}
            type="number"
            min={1}
            max={180}
            value={rest}
            onChange={(event) => setRest(event.target.value)}
          />
        </FormField>
      )}
      {record(widget.data).mode === "rest" && <p className={s.quiet}>다음 휴식부터 적용해요.</p>}
      {restConflict && (
        <p role="alert" className={s.error}>
          휴식 시간이 다른 곳에서 바뀌었어요.
        </p>
      )}
      <div className={s.row}>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !restDirty || restConflict}
          onClick={() => void save("rest")}
        >
          휴식 시간 저장
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={busy || !restDirty}
          onClick={() => {
            const value =
              restSavedRevision.current !== null && widget.revision <= restSavedRevision.current
                ? restBase
                : savedRest;
            setRest(String(value));
            setRestBase(value);
            setError("");
          }}
        >
          휴식 변경 취소
        </Button>
      </div>
      {calendar ? (
        <>
          <FormField label="일정 시작 알람">
            <Select disabled={busy} value={lead} onChange={(event) => setLead(event.target.value)}>
              <option value="off">알람 없음</option>
              <option value="0">시작 시각</option>
              {[5, 10, 15, 30].map((value) => (
                <option key={value} value={value}>
                  {value}분 전
                </option>
              ))}
              <option value="custom">직접 설정</option>
            </Select>
          </FormField>
          {(lead === "custom" || !["off", "0", "5", "10", "15", "30"].includes(lead)) && (
            <FormField label="알람 시간 직접 입력 (분 전)">
              <TextField
                disabled={busy}
                type="number"
                min={0}
                max={120}
                value={lead === "custom" ? custom : lead}
                onChange={(event) => {
                  setLead("custom");
                  setCustom(event.target.value);
                }}
              />
            </FormField>
          )}
          {embedded ? (
            <SettingControlRow
              title="OS 알림도 받기"
              control={
                <Switch
                  aria-label="OS 알림도 받기"
                  disabled={busy}
                  checked={osEnabled}
                  onChange={(event) => setOsEnabled(event.target.checked)}
                />
              }
            />
          ) : (
            <Checkbox
              disabled={busy}
              checked={osEnabled}
              onChange={(event) => setOsEnabled(event.target.checked)}
            >
              OS 알림도 받기
            </Checkbox>
          )}
          {embedded ? (
            <SettingControlRow
              title="알림 소리"
              control={
                <Switch
                  aria-label="알림 소리"
                  disabled={busy}
                  checked={soundEnabled}
                  onChange={(event) => setSoundEnabled(event.target.checked)}
                />
              }
            />
          ) : (
            <Checkbox
              disabled={busy}
              checked={soundEnabled}
              onChange={(event) => setSoundEnabled(event.target.checked)}
            >
              알림 소리
            </Checkbox>
          )}
          {embedded && (
            <SettingControlRow
              title="친구가 시작할 때 응원하기"
              description="무드메이커 · 조용한 시간에는 쉬어요"
              control={
                <Switch
                  aria-label="친구가 시작할 때 응원하기"
                  disabled={busy}
                  checked={moodFocusStart}
                  onChange={(event) => setMoodFocusStart(event.target.checked)}
                />
              }
            />
          )}
          <p className={s.quiet}>
            일정 알람에 공통으로 적용해요. 집중 중 캐릭터는 조용히 있고, OS 알림은 선택한 설정을
            따라요.
          </p>
          <p className={s.quiet}>
            OS 알림:{" "}
            {{
              granted: "허용됨",
              denied: "꺼짐 · 시스템 설정에서 변경",
              prompt: "권한 요청 전",
              system: "시스템 설정을 따름",
              unknown: "확인 필요",
            }[permission] || permission}
          </p>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={() => void requestPermission()}
          >
            OS 알림 권한 요청
          </Button>
          {alertsConflict && (
            <p role="alert" className={s.error}>
              일정 알림이 다른 곳에서 바뀌었어요.
            </p>
          )}
          <div className={s.row}>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !alertsDirty || alertsConflict}
              onClick={() => void save("alerts")}
            >
              일정 알림 저장
            </Button>
            <Button
              type="button"
              variant="quiet"
              disabled={busy || !alertsDirty}
              onClick={() => {
                loadAlerts(
                  alertsSavedRevision.current !== null &&
                    calendar.revision <= alertsSavedRevision.current
                    ? alertsBase
                    : reminders,
                );
                setError("");
              }}
            >
              알림 변경 취소
            </Button>
          </div>
        </>
      ) : (
        <p className={s.quiet}>캘린더를 켜면 일정 알람도 설정할 수 있어요.</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <div className={s.row}>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "저장 중…" : "설정 저장"}
        </Button>
        {!embedded && (
          <Button variant="quiet" disabled={saving} onClick={onClose}>
            취소
          </Button>
        )}
      </div>
    </form>
  );
  return (
    <>
      {embedded ? (
        form
      ) : (
        <Dialog
          isOpen
          onOpenChange={(open) => {
            if (!open && !saving) {
              if (restDirty || alertsDirty) setConfirmClose(true);
              else onClose();
            }
          }}
          title="집중 설정"
          closeLabel="설정 닫기"
          size="small"
        >
          {form}
        </Dialog>
      )}
      <Dialog
        isOpen={confirmClose}
        title="설정 변경을 버릴까요?"
        onOpenChange={setConfirmClose}
        size="small"
      >
        <Button variant="secondary" onClick={() => setConfirmClose(false)}>
          계속 편집
        </Button>
        <Button variant="critical" disabled={saving} onClick={onClose}>
          변경을 버리고 닫기
        </Button>
      </Dialog>
    </>
  );
}
