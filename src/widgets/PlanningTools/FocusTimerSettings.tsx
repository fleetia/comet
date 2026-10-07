import { Button, Checkbox, Dialog, FormField, Select, TextField } from "@fleetia/lagrange";
import { useEffect, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { number, record, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as s from "./FocusTimer.css";

export function FocusTimerSettings({
  widget,
  calendar,
  act,
  onClose,
}: {
  widget: WidgetView;
  calendar?: WidgetView;
  act: ToolAction;
  onClose: () => void;
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
  const [permission, setPermission] = useState("unknown");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    void command<string>("get_planner_notification_permission")
      .then((value) => {
        if (active) setPermission(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function requestPermission(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      setPermission(await command<string>("request_planner_notification_permission"));
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function save(): Promise<void> {
    const restMinutes = Number(rest);
    const leadMinutes = lead === "custom" ? Number(custom) : Number(lead);
    if (!Number.isFinite(restMinutes) || restMinutes < 1 || restMinutes > 180) {
      setError("휴식 시간은 1~180분으로 입력해 주세요.");
      return;
    }
    if (
      lead !== "off" &&
      (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 120)
    ) {
      setError("일정 알람은 시작 시각부터 120분 전까지 설정할 수 있어요.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!(await act("configure-settings", { restDurationMs: Math.round(restMinutes * 60000) })))
        return;
      if (calendar) {
        const input: DataRecord = {
          ...reminders,
          enabled: lead !== "off",
          leadMinutes: lead === "off" ? savedLead : leadMinutes,
          osEnabled,
          soundEnabled,
        };
        if (!(await act("configure-alerts", input, calendar))) {
          setNotice("휴식 시간은 저장했어요. 일정 알람 설정을 다시 저장해 주세요.");
          return;
        }
      }
      onClose();
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="집중 설정"
      closeLabel="설정 닫기"
      size="small"
    >
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
        {record(widget.data).mode === "rest" && <p className={s.quiet}>다음 휴식부터 적용해요.</p>}
        {calendar ? (
          <>
            <FormField label="일정 시작 알람">
              <Select
                disabled={busy}
                value={lead}
                onChange={(event) => setLead(event.target.value)}
              >
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
            <Checkbox
              disabled={busy}
              checked={osEnabled}
              onChange={(event) => setOsEnabled(event.target.checked)}
            >
              OS 알림도 받기
            </Checkbox>
            <Checkbox
              disabled={busy}
              checked={soundEnabled}
              onChange={(event) => setSoundEnabled(event.target.checked)}
            >
              알림 소리
            </Checkbox>
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
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            취소
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
