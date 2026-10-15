import { useEffect, useRef, useState, type ReactElement } from "react";
import { SegmentedControl } from "@comet/ui";
import { Button, DateField, Dialog, Select, TextArea, TextField } from "../../ui";
import { localDay, text, type DataRecord } from "../toolData";
import { eventTime } from "../Planner/plannerData";
import { PLANNER_TEMPLATES, templateItems } from "../Planner/templateCatalog";
import * as s from "../Planner/diaryEnvelope.css";

export function PreparationCreate({
  events,
  busy,
  onCreate,
  onClose,
  onDirtyChange,
}: {
  events: DataRecord[];
  busy: boolean;
  onCreate: (input: DataRecord, requestId: string) => Promise<boolean>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [when, setWhen] = useState("undated");
  const [eventId, setEventId] = useState("");
  const [date, setDate] = useState(localDay());
  const [checks, setChecks] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [reminderDays, setReminderDays] = useState("inherit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<{ id: string; input: DataRecord } | null>(null);
  const pending = useRef(false);
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  const dirty = Boolean(
    name || checks || templateId || when !== "undated" || reminderDays !== "inherit" || attempt,
  );
  useEffect(() => {
    report.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => report.current?.(false), []);
  const availableEvents = events.filter((event) => !event.cancelled);
  const selectedEvent = availableEvents.find((event) => event.id === eventId);
  const template = PLANNER_TEMPLATES.find((value) => value.id === templateId);
  const disabled = busy || saving;
  const locked = disabled || Boolean(attempt);
  const valid = name.trim() && (when !== "event" || selectedEvent) && (when !== "date" || date);

  async function create(): Promise<void> {
    if (pending.current || disabled || !valid) return;
    const checkLines = checks
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (checkLines.length >= 2000 || checkLines.some((value) => value.length > 1000)) {
      setError("챙길 것은 1999개까지, 한 항목은 1000자까지 적어 주세요.");
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    const baseDate =
      when === "date"
        ? date
        : text(selectedEvent?.startDate) ||
          (typeof selectedEvent?.startAt === "number"
            ? localDay(new Date(selectedEvent.startAt))
            : localDay());
    const request = attempt ?? {
      id: crypto.randomUUID(),
      input: {
        title: name.trim(),
        ...(when === "event" && selectedEvent
          ? { eventId, eventLabel: text(selectedEvent.title) }
          : {}),
        ...(when === "date" ? { date } : {}),
        checks: checkLines,
        tasks: template ? templateItems(template, baseDate) : [],
        reminderDays: reminderDays === "inherit" ? null : Number(reminderDays),
      },
    };
    setAttempt(request);
    try {
      if (!(await onCreate(request.input, request.id))) {
        setError("봉투 저장을 확인하지 못했어요. 다시 시도하면 같은 요청으로 결과를 확인해요.");
      }
    } catch {
      setError("봉투 저장을 확인하지 못했어요. 입력한 내용은 남아 있어요. 다시 시도해 주세요.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog
      isOpen
      title="새 준비 봉투"
      size="small"
      closeLabel="새로 만들기 닫기"
      onOpenChange={(open) => {
        if (!open && !disabled) onClose();
      }}
    >
      <form
        className={s.createForm}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className={s.createField}>
          <label className={s.createLabel} htmlFor="envelope-create-name">
            이름
          </label>
          <TextField
            id="envelope-create-name"
            aria-label="봉투 이름"
            autoFocus
            required
            maxLength={500}
            placeholder="무엇을 준비하나요?"
            value={name}
            disabled={locked}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className={s.createField}>
          <span className={s.createLabel}>언제</span>
          <SegmentedControl
            label="봉투 날짜 방식"
            value={when}
            disabled={locked}
            options={[
              { value: "event", label: "일정에 연결" },
              { value: "date", label: "날짜만" },
              { value: "undated", label: "날짜 없이" },
            ]}
            onValueChange={setWhen}
          />
        </div>
        {when === "event" && (
          <div className={s.createField}>
            <label className={s.createLabel} htmlFor="envelope-create-event">
              일정
            </label>
            <div className={s.createControl}>
              <Select
                id="envelope-create-event"
                value={eventId}
                disabled={locked}
                required
                onChange={(event) => setEventId(event.target.value)}
              >
                <option value="">일정 선택</option>
                {availableEvents.map((event) => (
                  <option key={text(event.id)} value={text(event.id)}>
                    {text(event.startDate) ||
                      (typeof event.startAt === "number"
                        ? localDay(new Date(event.startAt))
                        : "")}{" "}
                    {eventTime(event)} · {text(event.title)}
                  </option>
                ))}
              </Select>
              {!availableEvents.length && (
                <p className={s.caption}>
                  연결할 일정이 없어요. 날짜만 정하거나 날짜 없이 시작할 수 있어요.
                </p>
              )}
            </div>
          </div>
        )}
        {when === "date" && (
          <div className={s.createField}>
            <label className={s.createLabel} htmlFor="envelope-create-date">
              날짜
            </label>
            <DateField
              id="envelope-create-date"
              required
              value={date}
              disabled={locked}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        )}
        <div className={s.createField}>
          <label className={s.createLabel} htmlFor="envelope-create-checks">
            챙길 것
          </label>
          <TextArea
            id="envelope-create-checks"
            rows={3}
            value={checks}
            disabled={locked}
            placeholder="한 줄에 하나씩 적어 주세요"
            onChange={(event) => setChecks(event.target.value)}
          />
        </div>
        <div className={s.createField}>
          <label className={s.createLabel} htmlFor="envelope-create-template">
            준비할 일
          </label>
          <div className={s.createControl}>
            <Select
              id="envelope-create-template"
              value={templateId}
              disabled={locked}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">나중에 추가</option>
              {PLANNER_TEMPLATES.map((value) => (
                <option key={value.id} value={value.id}>
                  템플릿에서 · {value.title}
                </option>
              ))}
            </Select>
            {template && (
              <p className={s.caption}>
                {template.items[0]?.title} 외 {template.items.length - 1}개
              </p>
            )}
          </div>
        </div>
        <div className={s.createField}>
          <label className={s.createLabel} htmlFor="envelope-create-reminder">
            알림
          </label>
          <Select
            id="envelope-create-reminder"
            value={reminderDays}
            disabled={locked}
            onChange={(event) => setReminderDays(event.target.value)}
          >
            <option value="inherit">준비 봉투 설정 따르기</option>
            <option value="0">알리지 않기</option>
            <option value="1">1일 전</option>
            <option value="3">3일 전</option>
            <option value="7">7일 전</option>
          </Select>
        </div>
        <p className={s.caption}>
          일정 날짜가 오기 전부터 할 일, 챙길 것, 자료를 모아 둬요. 알림과 일정 종료 후 보관 질문은
          준비 봉투 설정을 따라요.
        </p>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        <div className={s.actions}>
          <Button variant="secondary" disabled={disabled} onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={disabled || !valid}>
            {attempt ? "같은 요청으로 다시 시도" : "만들기"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
