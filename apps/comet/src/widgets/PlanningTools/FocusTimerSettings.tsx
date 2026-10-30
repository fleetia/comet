import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  Button,
  FormField,
  SegmentedControl,
  SelectField,
  SettingControlRow,
  Stepper,
  Switch,
  TextInput,
} from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { canOpenNotificationSettings, notificationSettingsText, openSystemSettings } from "../../systemSettings";
import { number, record, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as s from "./FocusTimer.css";

type SettingsDraft = {
  rest: string;
  autoStartRest: boolean;
  continuous: boolean;
  longRestEvery: string;
  longRest: string;
  finishNotification: string;
  finishSoundEnabled: boolean;
  lead: string;
  recordTimeline: boolean;
};
function readSettings(widget: WidgetView): SettingsDraft {
  const settings = record(record(widget.data).settings);
  return {
    rest: String((number(settings.restDurationMs) || 300000) / 60000),
    autoStartRest: settings.autoStartRest === true,
    continuous: settings.continuous === true,
    longRestEvery: String(number(settings.longRestEvery) || 4),
    longRest: String((number(settings.longRestDurationMs) || 900000) / 60000),
    finishNotification: text(settings.finishNotification) || "bubble",
    finishSoundEnabled: settings.finishSoundEnabled === true,
    lead:
      typeof settings.linkedEventLeadMinutes === "number"
        ? String(settings.linkedEventLeadMinutes)
        : "off",
    recordTimeline: settings.recordTimeline !== false,
  };
}
function payload(draft: SettingsDraft): DataRecord {
  return {
    restDurationMs: Math.round(Number(draft.rest) * 60000),
    autoStartRest: draft.autoStartRest,
    continuous: draft.continuous,
    longRestEvery: Number(draft.longRestEvery),
    longRestDurationMs: Math.round(Number(draft.longRest) * 60000),
    finishNotification: draft.finishNotification,
    finishSoundEnabled: draft.finishSoundEnabled,
    linkedEventLeadMinutes: draft.lead === "off" ? null : Number(draft.lead),
    recordTimeline: draft.recordTimeline,
  };
}

const AUTOSAVE_DELAY = 500;
const validationMessages = [
  "휴식 시간은 1~180분으로 입력해 주세요.",
  "긴 휴식은 1~180분, 회차는 2~8회로 입력해 주세요.",
  "연결한 일정 알림은 시작 시각부터 120분 전까지 설정할 수 있어요.",
];

function validationError(draft: SettingsDraft): string {
  if (
    !draft.longRest.trim() ||
    !Number.isFinite(Number(draft.longRest)) ||
    Number(draft.longRest) < 1 ||
    Number(draft.longRest) > 180 ||
    !Number.isInteger(Number(draft.longRestEvery)) ||
    Number(draft.longRestEvery) < 2 ||
    Number(draft.longRestEvery) > 8
  )
    return "긴 휴식은 1~180분, 회차는 2~8회로 입력해 주세요.";
  if (
    !draft.rest.trim() ||
    !Number.isFinite(Number(draft.rest)) ||
    Number(draft.rest) < 1 ||
    Number(draft.rest) > 180
  )
    return "휴식 시간은 1~180분으로 입력해 주세요.";
  if (
    draft.lead !== "off" &&
    (!draft.lead.trim() ||
      !Number.isInteger(Number(draft.lead)) ||
      Number(draft.lead) < 0 ||
      Number(draft.lead) > 120)
  )
    return "연결한 일정 알림은 시작 시각부터 120분 전까지 설정할 수 있어요.";
  return "";
}

/** Focus settings save as soon as a valid value changes; failures keep the typed value. */
export function FocusTimerSettings({
  widget,
  calendar,
  act,
  onDirtyChange,
  onBusyChange,
  durationControl,
  disabled = false,
}: {
  widget: WidgetView;
  calendar?: WidgetView;
  act: ToolAction;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  durationControl?: ReactNode;
  disabled?: boolean;
}): ReactElement {
  const saved = readSettings(widget);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [base, setBase] = useState(saved);
  const reminders = record(record(calendar?.data).reminders);
  const savedCheer = reminders.moodFocusStart === true;
  const [cheer, setCheer] = useState(savedCheer);
  const [cheerBase, setCheerBase] = useState(savedCheer);
  const [busy, setBusy] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permission, setPermission] = useState("unknown");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const failedDraft = useRef<string | null>(null);
  const failedCheer = useRef<boolean | null>(null);
  const [retry, setRetry] = useState(0);
  const [customLead, setCustomLead] = useState(
    !["off", "0", "5", "10", "15", "30"].includes(saved.lead),
  );
  const savedRevision = useRef<number | null>(null);
  const cheerSavedRevision = useRef<number | null>(null);
  const locked = useRef(false);
  const permissionLock = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const permissionRequest = useRef(0);
  const latest = useRef({ widget, calendar });
  latest.current = { widget, calendar };
  const scope = `${widget.id}:${calendar?.id ?? ""}`;
  const previousScope = useRef(scope);
  if (previousScope.current !== scope) {
    previousScope.current = scope;
    generation.current += 1;
  }
  const report = useRef({ onDirtyChange, onBusyChange });
  report.current = { onDirtyChange, onBusyChange };
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const cheerDirty = cheer !== cheerBase;
  const conflict =
    dirty &&
    savedKey !== JSON.stringify(base) &&
    (savedRevision.current === null || widget.revision > savedRevision.current);
  const cheerConflict =
    cheerDirty &&
    savedCheer !== cheerBase &&
    (cheerSavedRevision.current === null || (calendar?.revision ?? 0) > cheerSavedRevision.current);
  useEffect(() => {
    setDraft(saved);
    setBase(saved);
    setCheer(savedCheer);
    setCheerBase(savedCheer);
    setCustomLead(!["off", "0", "5", "10", "15", "30"].includes(saved.lead));
    savedRevision.current = null;
    cheerSavedRevision.current = null;
    locked.current = false;
    setBusy(false);
    setError("");
    setNotice("");
  }, [scope]);
  useEffect(() => {
    if (
      !dirty &&
      !locked.current &&
      (savedRevision.current === null || widget.revision > savedRevision.current)
    ) {
      savedRevision.current = null;
      setDraft(saved);
      setBase(saved);
      setCustomLead(!["off", "0", "5", "10", "15", "30"].includes(saved.lead));
    }
  }, [widget.revision, savedKey, dirty]);
  useEffect(() => {
    if (
      !cheerDirty &&
      !locked.current &&
      (cheerSavedRevision.current === null ||
        (calendar?.revision ?? 0) > cheerSavedRevision.current)
    ) {
      cheerSavedRevision.current = null;
      setCheer(savedCheer);
      setCheerBase(savedCheer);
    }
  }, [calendar?.revision, savedCheer, cheerDirty]);
  useEffect(() => {
    report.current.onDirtyChange?.(dirty || Boolean(calendar && cheerDirty));
    report.current.onBusyChange?.(busy);
  }, [dirty, cheerDirty, calendar, busy]);
  useEffect(() => {
    mounted.current = true;
    const version = generation.current;
    function refreshPermission(): void {
      if (!isDesktop() || permissionLock.current) return;
      const request = ++permissionRequest.current;
      void command<string>("get_planner_notification_permission")
        .then((value) => {
          if (
            mounted.current &&
            generation.current === version &&
            permissionRequest.current === request
          )
            setPermission(value);
        })
        .catch(() => {});
    }
    refreshPermission();
    window.addEventListener("focus", refreshPermission);
    return () => {
      window.removeEventListener("focus", refreshPermission);
      mounted.current = false;
      generation.current += 1;
      report.current.onDirtyChange?.(false);
      report.current.onBusyChange?.(false);
    };
  }, []);
  async function requestPermission(): Promise<void> {
    if (permissionLock.current) return;
    permissionLock.current = true;
    setPermissionBusy(true);
    const request = ++permissionRequest.current;
    const version = generation.current;
    try {
      const value = await command<string>("request_planner_notification_permission");
      if (
        mounted.current &&
        generation.current === version &&
        permissionRequest.current === request
      )
        setPermission(value);
    } catch (cause: unknown) {
      if (mounted.current && generation.current === version) setError(errorText(cause));
    } finally {
      permissionLock.current = false;
      if (mounted.current) setPermissionBusy(false);
    }
  }
  async function save(onlyCheer = false): Promise<void> {
    if (locked.current) return;
    const invalid = onlyCheer ? "" : validationError(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    if ((!onlyCheer && conflict) || cheerConflict) {
      setError("다른 곳에서 설정이 바뀌었어요. 최신 저장값을 확인한 뒤 다시 입력해 주세요.");
      return;
    }
    const version = generation.current;
    const timerTarget = widget;
    const calendarTarget = calendar;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!onlyCheer) {
        const ok = await act("configure-settings", payload(draft), timerTarget);
        if (!mounted.current || generation.current !== version) return;
        if (!ok) {
          failedDraft.current = JSON.stringify(draft);
          setError("집중 설정을 저장하지 못했어요. 입력은 남아 있어요.");
          return;
        }
        if (
          latest.current.widget.revision > timerTarget.revision &&
          JSON.stringify(readSettings(latest.current.widget)) !== JSON.stringify(draft)
        ) {
          failedDraft.current = JSON.stringify(draft);
          setError("집중 설정이 다른 곳에서 바뀌었어요. 입력은 남아 있어요.");
          return;
        }
        failedDraft.current = null;
        savedRevision.current = latest.current.widget.revision;
        setBase(draft);
      }
      if (onlyCheer && calendarTarget && cheerDirty) {
        const current = latest.current.calendar;
        if (
          !current ||
          (record(record(current.data).reminders).moodFocusStart === true) !== cheerBase
        ) {
          failedCheer.current = cheer;
          setError("응원 설정이 다른 곳에서 바뀌었어요. 입력은 남아 있어요.");
          return;
        }
        const input = { ...record(record(current.data).reminders), moodFocusStart: cheer };
        const ok = await act("configure-alerts", input, current);
        if (!mounted.current || generation.current !== version) return;
        if (!ok) {
          failedCheer.current = cheer;
          setError("응원 설정을 저장하지 못했어요. 입력은 남아 있어요.");
          return;
        }
        const newest = latest.current.calendar;
        if (
          newest &&
          newest.revision > current.revision &&
          (record(record(newest.data).reminders).moodFocusStart === true) !== cheer
        ) {
          failedCheer.current = cheer;
          setError("응원 설정이 다른 곳에서 바뀌었어요. 입력은 남아 있어요.");
          return;
        }
        cheerSavedRevision.current = newest?.revision ?? current.revision;
        failedCheer.current = null;
        setCheerBase(cheer);
      }
    } catch (cause: unknown) {
      if (mounted.current && generation.current === version) {
        if (onlyCheer) failedCheer.current = cheer;
        else failedDraft.current = JSON.stringify(draft);
        setError(errorText(cause));
      }
    } finally {
      if (generation.current === version) {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  function cancelChanges(): void {
    const value =
      savedRevision.current !== null && widget.revision <= savedRevision.current ? base : saved;
    setDraft(value);
    setBase(value);
    setCustomLead(!["off", "0", "5", "10", "15", "30"].includes(value.lead));
    const nextCheer =
      cheerSavedRevision.current !== null && (calendar?.revision ?? 0) <= cheerSavedRevision.current
        ? cheerBase
        : savedCheer;
    setCheer(nextCheer);
    setCheerBase(nextCheer);
    setError("");
  }
  const draftKey = JSON.stringify(draft);
  useEffect(() => {
    if (
      !dirty ||
      conflict ||
      locked.current ||
      failedDraft.current === draftKey ||
      validationError(draft)
    )
      return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [draftKey, dirty, conflict, busy, retry]);
  useEffect(() => {
    if (!cheerDirty || cheerConflict || locked.current || failedCheer.current === cheer) return;
    void save(true);
  }, [cheer, cheerDirty, cheerConflict, busy, retry]);
  useEffect(() => {
    const invalid = dirty ? validationError(draft) : "";
    setError((current) =>
      invalid ? invalid : current && validationMessages.includes(current) ? "" : current,
    );
  }, [draftKey, dirty]);
  async function previewAlarm(): Promise<void> {
    setError("");
    setNotice("");
    try {
      await command("preview_planner_notification");
      if (mounted.current) setNotice("OS에 미리보기 알림을 보냈어요.");
    } catch (cause: unknown) {
      if (mounted.current) setError(errorText(cause));
    }
  }
  const form = (
    <form
      className={s.settingsRoot}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
      }}
      onSubmit={(event) => event.preventDefault()}
    >
      <fieldset className={s.controlFields} disabled={disabled}>
        <section className={s.settingsSection} aria-label="시간">
          <h3 className={s.settingsHeading}>시간</h3>
          <div className={s.settingsGroup}>
            {durationControl}
            <SettingControlRow
              className={s.settingRow}
              title="휴식 시간"
              control={
                <Stepper
                  size="compact"
                  aria-label="휴식 시간 (분)"
                  aria-description="다음 휴식부터 적용해요"
                  disabled={busy}
                  min={1}
                  max={180}
                  unit="분"
                  value={draft.rest}
                  onChange={(event) => setDraft({ ...draft, rest: event.target.value })}
                  onValueChange={(value) => setDraft({ ...draft, rest: String(value) })}
                />
              }
            />
            <SettingControlRow
              className={s.settingRow}
              title="집중이 끝나면 휴식 바로 시작"
              control={
                <Switch
                  aria-label="집중이 끝나면 휴식 바로 시작"
                  checked={draft.autoStartRest}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, autoStartRest: event.target.checked })}
                />
              }
            />
            <SettingControlRow
              className={s.settingRow}
              title="연속 모드"
              description="휴식이 끝나면 다음 집중을 시작해요"
              control={
                <Switch
                  aria-label="연속 모드"
                  checked={draft.continuous}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, continuous: event.target.checked })}
                />
              }
            />
            <SettingControlRow
              className={s.settingRow}
              title="긴 휴식 주기"
              control={
                <Stepper
                  size="compact"
                  aria-label="긴 휴식 주기 (회)"
                  disabled={busy}
                  min={2}
                  max={8}
                  unit="회"
                  value={draft.longRestEvery}
                  onChange={(event) => setDraft({ ...draft, longRestEvery: event.target.value })}
                  onValueChange={(value) => setDraft({ ...draft, longRestEvery: String(value) })}
                />
              }
            />
            <SettingControlRow
              className={s.settingRow}
              title="긴 휴식 시간"
              control={
                <Stepper
                  size="compact"
                  aria-label="긴 휴식 시간 (분)"
                  disabled={busy}
                  min={1}
                  max={180}
                  unit="분"
                  value={draft.longRest}
                  onChange={(event) => setDraft({ ...draft, longRest: event.target.value })}
                  onValueChange={(value) => setDraft({ ...draft, longRest: String(value) })}
                />
              }
            />
          </div>
        </section>
        <section className={s.settingsSection} aria-label="알림">
          <h3 className={s.settingsHeading}>알림</h3>
          <div className={s.settingsGroup}>
            <SettingControlRow
              className={s.settingRow}
              title="끝날 때 알리기"
              control={
                <SegmentedControl
                  label="끝날 때 알리기"
                  appearance="contained"
                  value={draft.finishNotification}
                  disabled={busy}
                  options={[
                    { value: "bubble", label: "말풍선" },
                    { value: "os", label: "OS 알림" },
                    { value: "both", label: "둘 다" },
                  ]}
                  onValueChange={(value) => setDraft({ ...draft, finishNotification: value })}
                />
              }
            />
            <SettingControlRow
              className={s.settingRow}
              title="알림 소리"
              control={
                <SelectField
                  controlSize={34}
                  aria-label="알림 소리"
                  disabled={busy}
                  value={draft.finishSoundEnabled ? "system" : "off"}
                  onChange={(event) =>
                    setDraft({ ...draft, finishSoundEnabled: event.target.value === "system" })
                  }
                >
                  <option value="system">시스템 설정을 따름</option>
                  <option value="off">소리 없음</option>
                </SelectField>
              }
            />
            <SettingControlRow
              className={s.settingRow}
              title="연결한 일정 시작 전 알리기"
              description="일정에 이어 둔 집중만 알려요"
              control={
                <SelectField
                  controlSize={34}
                  aria-label="연결한 일정 시작 전 알리기"
                  disabled={busy}
                  value={customLead ? "custom" : draft.lead}
                  onChange={(event) => {
                    setCustomLead(event.target.value === "custom");
                    setDraft({
                      ...draft,
                      lead: event.target.value === "custom" ? "5" : event.target.value,
                    });
                  }}
                >
                  <option value="off">알림 없음</option>
                  <option value="0">시작 시각</option>
                  {[5, 10, 15, 30].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes}분 전
                    </option>
                  ))}
                  <option value="custom">직접 설정</option>
                </SelectField>
              }
            />
            {customLead && (
              <FormField label="알람 시간 직접 입력 (분 전)">
                <TextInput
                  fill
                  type="number"
                  min={0}
                  max={120}
                  disabled={busy}
                  value={draft.lead}
                  onChange={(event) => setDraft({ ...draft, lead: event.target.value })}
                />
              </FormField>
            )}
          </div>
          <div className={s.settingsCaption}>
            <span>OS 알림이 꺼져 있으면 말풍선으로만 알려요. </span>
            <details className={s.notificationDetails}>
              <summary>알림 설정</summary>
              <div className={s.row}>
                <span className={s.quiet}>
                  OS 알림:{" "}
                  {(
                    {
                      granted: "허용됨",
                      denied: notificationSettingsText(),
                      prompt: "권한 요청 전",
                      system: "시스템 설정을 따름",
                      unknown: "확인 필요",
                    } as Record<string, string>
                  )[permission] || permission}
                </span>
                {isDesktop() && permission === "denied" && canOpenNotificationSettings() && (
                  <Button type="button" variant="ghost" onClick={() => void openSystemSettings("notifications").catch((cause: unknown) => setError(errorText(cause)))}>
                    시스템 설정 열기
                  </Button>
                )}
                {permission !== "denied" && <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || permissionBusy}
                  onClick={() => void requestPermission()}
                >
                  OS 알림 권한 요청
                </Button>}
                <Button type="button" variant="ghost" onClick={() => void previewAlarm()}>
                  알림 미리보기
                </Button>
              </div>
            </details>
          </div>
        </section>
        <section className={s.settingsSection} aria-label="집중하는 동안">
          <h3 className={s.settingsHeading}>집중하는 동안</h3>
          <div className={s.settingsGroup}>
            <SettingControlRow
              className={s.settingRow}
              title="친구들 조용히 하기"
              description="말을 걸면 앱 안내로 집중 중이라고 알려요"
              control={<span className={s.quiet}>항상 켜짐</span>}
            />
            <SettingControlRow
              className={s.settingRow}
              title="시간표에 집중 칸 칠하기"
              description="다이어리 하루·주 보기에 자동으로 남아요"
              control={
                <Switch
                  aria-label="시간표에 집중 칸 칠하기"
                  aria-description="다음 집중부터 적용해요"
                  disabled={busy}
                  checked={draft.recordTimeline}
                  onChange={(event) => setDraft({ ...draft, recordTimeline: event.target.checked })}
                />
              }
            />
            <SettingControlRow
              className={s.settingRow}
              title="친구가 시작할 때 응원하기"
              description={
                calendar
                  ? "무드메이커 · 조용한 시간에는 쉬어요"
                  : "캘린더를 켜면 무드메이커 응원을 설정할 수 있어요"
              }
              control={
                <Switch
                  aria-label="친구가 시작할 때 응원하기"
                  disabled={busy || !calendar}
                  checked={cheer}
                  onChange={(event) => setCheer(event.target.checked)}
                />
              }
            />
          </div>
        </section>
        {(conflict || cheerConflict) && (
          <p role="alert" className={s.error}>
            설정이 다른 곳에서 바뀌었어요. 최신 값을 불러온 뒤 다시 바꿔 주세요.
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className={s.quiet}>
            저장하고 있어요.
          </p>
        )}
        {(conflict || cheerConflict || (error && (dirty || cheerDirty))) && (
          <div className={s.row}>
            {error && !conflict && !cheerConflict && !validationError(draft) && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  failedDraft.current = null;
                  failedCheer.current = null;
                  setError("");
                  setRetry((value) => value + 1);
                }}
              >
                다시 저장
              </Button>
            )}
            <Button type="button" variant="ghost" disabled={busy} onClick={cancelChanges}>
              최신 값 불러오기
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
  return form;
}
