import { SegmentedControl, Select, SettingControlRow, Switch } from "@comet/ui";
import { Icon } from "@comet/icon";
import { Button, TextField } from "../../ui";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { localDay, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import {
  anniversaryDescription,
  anniversaryLabel,
  anniversaryTarget,
  clockFeatured,
  clockTime,
} from "./clockData";
import * as clock from "./clock.css";

type Props = { widget: WidgetView; widgets: WidgetView[]; act: ToolAction };
export { TimerTool } from "./FocusTimerTool";
export function ClockTool({
  widget,
  act,
  compact = false,
  onDirtyChange,
}: Props & { compact?: boolean; onDirtyChange?: (dirty: boolean) => void }): ReactElement {
  const data = record(widget.data);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const titleInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(localDay());
  const [repeat, setRepeat] = useState("none");
  const [countMode, setCountMode] = useState("remaining");
  const [showOnWidget, setShowOnWidget] = useState(false);
  const [celebrate, setCelebrate] = useState(true);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const editRevision = useRef(0);
  function changeDraft(change: () => void): void {
    editRevision.current += 1;
    change();
  }
  const featured = clockFeatured(data);
  const anniversaries = rows(data.anniversaries);
  const editingMissing = id !== null && !anniversaries.some((item) => item.id === id);
  useEffect(() => {
    onDirtyChange?.(creating && (Boolean(title.trim()) || id !== null));
  }, [creating, title, id, onDirtyChange]);
  useEffect(() => {
    if (creating) titleInput.current?.focus();
  }, [creating, id]);
  function reset(): void {
    editRevision.current += 1;
    setId(null);
    setTitle("");
    setDate(localDay());
    setRepeat("none");
    setCountMode("remaining");
    setShowOnWidget(false);
    setCelebrate(true);
    setCreating(false);
  }
  function edit(item: DataRecord): void {
    editRevision.current += 1;
    setCreating(true);
    setId(text(item.id));
    setTitle(text(item.title));
    setDate(text(item.date));
    setRepeat(text(item.repeat) || "none");
    setCountMode(text(item.countMode) || "remaining");
    setShowOnWidget(featured?.id === item.id);
    setCelebrate(item.celebrate === true);
  }
  async function save(action: string, input: DataRecord): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    const revision = editRevision.current;
    try {
      if (await act(action, input)) {
        if (editRevision.current === revision) reset();
      }
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const [year, month, day] = date.split("-").map(Number);
  function changeDate(nextYear: number, nextMonth: number, nextDay: number): void {
    editRevision.current += 1;
    const lastDay = new Date(nextYear, nextMonth, 0).getDate();
    setDate(
      `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(nextDay, lastDay)).padStart(2, "0")}`,
    );
  }
  const draft = { date, title, repeat, countMode };
  const previewDate =
    countMode === "elapsed" ? new Date(`${date}T12:00:00`) : anniversaryTarget(draft, now);
  const previewDateLabel = Number.isFinite(previewDate.getTime())
    ? previewDate.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
      })
    : "날짜 확인 필요";
  const editor = (
    <form
      className={clock.form}
      onSubmit={(event) => {
        event.preventDefault();
        void save(id ? "update" : "add", {
          ...(id ? { id } : {}),
          title,
          date,
          repeat,
          countMode,
          showOnWidget,
          celebrate,
        });
      }}
      aria-label={id ? "기념일 수정" : "새 기념일"}
    >
      {editingMissing && (
        <p role="status">다른 창에서 이 기념일을 지웠어요. 입력한 내용은 취소할 때까지 보관해요.</p>
      )}
      <div className={clock.editorTop}>
        <label htmlFor="anniversary-title">이름</label>
        <TextField
          id="anniversary-title"
          ref={titleInput}
          aria-label="기념일 이름"
          required
          maxLength={500}
          value={title}
          onChange={(event) => changeDraft(() => setTitle(event.target.value))}
        />
        <span className={clock.dateLabel}>날짜</span>
        <Select
          aria-label="기념일 월"
          value={month}
          onChange={(event) => changeDate(year, Number(event.target.value), day)}
        >
          {Array.from({ length: 12 }, (_, index) => (
            <option key={index} value={index + 1}>
              {index + 1}월
            </option>
          ))}
        </Select>
        <Select
          aria-label="기념일 일"
          value={day}
          onChange={(event) => changeDate(year, month, Number(event.target.value))}
        >
          {Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => (
            <option key={index} value={index + 1}>
              {index + 1}일
            </option>
          ))}
        </Select>
        <Select
          aria-label="기념일 반복과 연도"
          value={repeat === "yearly" ? "yearly" : year}
          onChange={(event) => {
            editRevision.current += 1;
            const value = event.target.value;
            setRepeat(value === "yearly" ? "yearly" : "none");
            if (value !== "yearly") changeDate(Number(value), month, day);
          }}
        >
          <option value="yearly">매년</option>
          {[
            ...new Set([
              ...(Number.isFinite(year) ? [year] : []),
              ...Array.from(
                { length: 151 },
                (_, index) => new Date(now).getFullYear() - 100 + index,
              ),
            ]),
          ]
            .sort((left, right) => left - right)
            .map((value) => (
              <option key={value} value={value}>
                {value}년
              </option>
            ))}
        </Select>
      </div>
      <div className={clock.countRow}>
        <span>세는 법</span>
        <SegmentedControl
          appearance="contained"
          label="기념일 세는 법"
          value={countMode}
          options={[
            { value: "elapsed", label: "지난 날" },
            { value: "remaining", label: "남은 날" },
            { value: "anniversary", label: "주년" },
          ]}
          onValueChange={(value) => changeDraft(() => setCountMode(value))}
        />
        <span className={clock.exampleLabel}>이렇게 보여요</span>
        <span className={clock.badge}>
          {title || "기념일"} · {anniversaryLabel(draft, now)} · {previewDateLabel}
        </span>
      </div>
      <div className={clock.options}>
        <SettingControlRow
          title="위젯에 보이기"
          description="켜면 지금 보이는 기념일과 바뀌어요"
          control={
            <Switch
              aria-label="위젯에 보이기"
              checked={showOnWidget}
              onChange={(event) => changeDraft(() => setShowOnWidget(event.target.checked))}
            />
          }
        />
        <SettingControlRow
          title="그날 친구가 축하하기"
          description="그날 아침 인사에 함께 말해요"
          control={
            <Switch
              aria-label="그날 친구가 축하하기"
              checked={celebrate}
              onChange={(event) => changeDraft(() => setCelebrate(event.target.checked))}
            />
          }
        />
      </div>
      <div className={clock.actions}>
        {id && !editingMissing && (
          <Button
            variant="critical"
            size="compact"
            disabled={saving}
            onClick={() => void save("delete", { id })}
          >
            <Icon name="remove" size={15} />
            지우기…
          </Button>
        )}
        <span className={clock.spacer} />
        <Button
          variant="secondary"
          size="compact"
          disabled={saving}
          aria-label="수정 취소"
          onClick={reset}
        >
          취소
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="compact"
          disabled={saving || editingMissing || !title.trim()}
          aria-label={id ? "기념일 변경 저장" : "기념일 추가"}
        >
          완료
        </Button>
      </div>
    </form>
  );
  return (
    <section className={clock.root} aria-label="기념일">
      <header className={clock.heading}>
        <h2>기념일</h2>
        <Button
          variant="secondary"
          size="compact"
          disabled={creating || saving}
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={15} />
          기념일 추가…
        </Button>
      </header>
      {!compact && <time className={clock.time}>{clockTime(data, now)}</time>}
      <div className={clock.list}>
        {anniversaries.map((item) => (
          <div key={text(item.id)} className={clock.item}>
            <article className={clock.row}>
              <span className={clock.icon}>
                <Icon name="gift" size={17} />
              </span>
              <div className={clock.identity}>
                <div className={clock.nameRow}>
                  <h3>{text(item.title)}</h3>
                  {featured?.id === item.id && <span className={clock.badge}>위젯</span>}
                </div>
                <p className={clock.date}>{anniversaryDescription(item)}</p>
              </div>
              <span className={clock.countdown}>{anniversaryLabel(item, now)}</span>
              {id !== item.id && (
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={saving}
                  aria-label={`수정 ${text(item.title)}`}
                  onClick={() => edit(item)}
                >
                  <Icon name="habit" size={15} />
                  고치기
                </Button>
              )}
            </article>
            {id === item.id && editor}
          </div>
        ))}
      </div>
      {((creating && id === null) || editingMissing) && editor}
      <p className={clock.caption}>위젯에는 하나만 보여요. 그날이 되면 친구가 먼저 축하해 줘요.</p>
    </section>
  );
}
export function ClockSettings({ widget, act }: Pick<Props, "widget" | "act">): ReactElement {
  const data = record(widget.data);
  return (
    <section className={clock.settings}>
      <h2>시계</h2>
      <div className={clock.list}>
        <SettingControlRow
          title="시간 표시"
          control={
            <SegmentedControl
              appearance="contained"
              label="시계 형식"
              value={text(data.format) || "24h"}
              options={[
                { value: "12h", label: "12시간" },
                { value: "24h", label: "24시간" },
              ]}
              onValueChange={(format) => void act("configure", { format })}
            />
          }
        />
        <SettingControlRow
          title="초 보이기"
          control={
            <Switch
              aria-label="초 보이기"
              checked={data.showSeconds === true}
              onChange={(event) => void act("configure", { showSeconds: event.target.checked })}
            />
          }
        />
        <SettingControlRow
          title="날짜 함께 보기"
          control={
            <Switch
              aria-label="날짜 함께 보기"
              checked={data.showDate !== false}
              onChange={(event) => void act("configure", { showDate: event.target.checked })}
            />
          }
        />
      </div>
    </section>
  );
}
