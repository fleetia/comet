import { useEffect, useRef, useState, type ReactElement } from "react";
import { Icon } from "@comet/icon";
import { Button, Select, SettingControlRow, SettingsSummary, Surface, Switch } from "@comet/ui";
import { errorText } from "../../hooks/useSnapshot";
import { record, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as s from "./preparationSettings.css";

export function PreparationSettings({
  widget,
  widgets,
  act,
  onBusyChange,
  onOpenRelated,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
  onBusyChange?: (busy: boolean) => void;
  onOpenRelated?: (widget: WidgetView) => void;
}): ReactElement {
  const data = record(widget.data);
  const calendar = widgets.find((item) => item.kind === "calendar");
  const reminders = record(
    record(calendar?.installed && calendar.enabled ? calendar.data : null).reminders,
  );
  const channelLabel =
    reminders.characterEnabled !== false
      ? reminders.osEnabled === true
        ? "말풍선 · 시스템"
        : "말풍선"
      : reminders.osEnabled === true
        ? "시스템"
        : "알림 꺼짐";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const report = useRef(onBusyChange);
  report.current = onBusyChange;
  useEffect(() => {
    report.current?.(busy);
  }, [busy]);
  useEffect(() => () => report.current?.(false), []);
  async function configure(input: DataRecord): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await act("configure", input, widget))) {
        setError("설정을 저장하지 못했어요. 다시 시도해 주세요.");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const connections = [
    {
      kind: "todo",
      title: "할 일",
      description: "할 일을 잇거나 챙길 것을 할 일로 옮겨요",
      icon: "todo" as const,
    },
    {
      kind: "calendar",
      title: "캘린더",
      description: "봉투에 일정을 이어 둬요",
      icon: "calendar" as const,
    },
    {
      kind: "focus-timer",
      title: "집중 타이머",
      description: "봉투를 열고 바로 집중해요",
      icon: "timer" as const,
    },
  ];
  return (
    <section className={s.root} aria-label="준비 봉투 설정">
      <h2 className={s.heading}>이렇게 써요</h2>
      <div className={s.steps}>
        {[
          "날짜 없이 봉투를 먼저 만들어요.",
          "챙길 것과 자료 링크를 담아요.",
          "할 일이나 일정은 나중에 이어요.",
        ].map((label, index) => (
          <Surface variant="card" key={label} className={s.step}>
            <span className={s.number}>{index + 1}</span>
            <p>{label}</p>
          </Surface>
        ))}
      </div>
      <h2 className={s.heading}>함께 쓰기</h2>
      <Surface variant="card" className={s.connections}>
        {connections.map((item) => {
          const related = widgets.find((value) => value.kind === item.kind);
          const enabled = related?.installed && related.enabled;
          return (
            <div className={s.connection} key={item.kind}>
              <SettingsSummary
                className={s.summary}
                variant="inline"
                title={item.title}
                description={item.description}
                leading={
                  <span className={s.icon}>
                    <Icon name={item.icon} size={20} />
                  </span>
                }
                disabled={busy || !related || !onOpenRelated}
                onClick={() => related && onOpenRelated?.(related)}
              />
              <span className={s.status} data-enabled={enabled || undefined}>
                {enabled ? "켜짐" : related?.installed ? "꺼짐" : "설치 안 됨"}
              </span>
            </div>
          );
        })}
      </Surface>
      <p className={s.caption}>같이 쓰면 좋은 위젯이에요. 없어도 준비 봉투는 혼자 써요.</p>
      <h2 className={s.heading}>설정</h2>
      <Surface variant="card" className={s.connections}>
        <SettingControlRow
          title="준비 알림"
          description="이어 둔 일정 날짜를 기준으로 알려요"
          control={
            <Select
              aria-label="준비 알림"
              value={typeof data.reminderDays === "number" ? data.reminderDays : 0}
              disabled={busy}
              onChange={(event) => void configure({ reminderDays: Number(event.target.value) })}
            >
              <option value={0}>알리지 않기</option>
              <option value={1}>1일 전 · {channelLabel}</option>
              <option value={3}>3일 전 · {channelLabel}</option>
              <option value={7}>7일 전 · {channelLabel}</option>
            </Select>
          }
        />
        <SettingControlRow
          title="일정이 끝나면 보관할지 묻기"
          control={
            <Switch
              aria-label="일정이 끝나면 보관할지 묻기"
              checked={data.askArchiveAfterEnd === true}
              disabled={busy}
              onChange={(event) => void configure({ askArchiveAfterEnd: event.target.checked })}
            />
          }
        />
      </Surface>
      <p className={s.caption}>
        알림 방식은{" "}
        {calendar && onOpenRelated ? (
          <Button
            variant="link"
            size="small"
            disabled={busy}
            onClick={() => onOpenRelated(calendar)}
          >
            알림 설정
          </Button>
        ) : (
          "알림 설정"
        )}
        을 따라요.
      </p>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
