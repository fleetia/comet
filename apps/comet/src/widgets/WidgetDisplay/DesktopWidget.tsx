import { type IconName } from "@comet/icon";
import {
  ClockWidget,
  EnvelopeFreeform,
  EnvelopeWidget,
  FocusTimerFreeform,
  MemoWidget,
  MusicFreeform,
  WeatherWidget,
  WidgetRow,
  CompactFreeform,
  type FreeformAppearanceProps,
  type WidgetKind,
} from "@comet/ui";
import { useState, type ReactElement } from "react";
import { command } from "../../hooks/useSnapshot";
import { countdown } from "../PlanningTools/FocusTimerData";
import {
  artworkUrl,
  finiteNumber,
  musicIsFresh,
  musicPosition,
  musicTime,
} from "../MusicTool/musicData";
import {
  localDay,
  number,
  record,
  rows,
  text,
  type DataRecord,
  type ToolAction,
} from "../toolData";
import { anniversaryLabel, clockDate, clockFeatured, clockTime } from "../PlanningTools/clockData";
import {
  weatherCondition,
  weatherConfig,
  weatherTemperature,
} from "../ConnectionTools/weatherData";
import { readDraft, TimerTool } from "../PlanningTools/FocusTimerTool";
import { MusicTool } from "../MusicTool/MusicTool";
import { preparationFocusInput, preparationProgress } from "../PreparationTool/preparationData";
import { useConnectionCommand } from "../useConnectionCommand";
import { eventStart } from "../Planner/plannerData";
import type { WidgetView } from "../types";
import { desktopKind } from "./desktopState";
import { desktopSkin } from "./desktopShape";
import * as s from "./widgetDisplay.css";

export function desktopWidgets(widgets: readonly WidgetView[]): WidgetView[] {
  return widgets.filter(
    (widget) => desktopKind(widget.kind) !== undefined,
  );
}
export function focusRemaining(widget: WidgetView, now: number): number {
  const data = record(widget.data);
  return Math.max(
    0,
    data.status === "running"
      ? Math.min(number(data.remainingMs), number(data.deadline) - now)
      : number(data.remainingMs),
  );
}
export function desktopSummary(
  widget: WidgetView,
  now: number,
  widgets: readonly WidgetView[] = [],
): { icon: IconName; title: string; description: string; value: string; meta: string } {
  const data = record(widget.data),
    observation = record(data.observation);
  switch (widget.kind) {
    case "todo": {
      const items = rows(data.items);
      const done = items.filter((item) => typeof item.completedAt === "number").length;
      return {
        icon: "check",
        title: "할 일",
        description: `${items.length - done}개 남음`,
        value: `${done} / ${items.length}`,
        meta: "",
      };
    }
    case "calendar": {
      const event = rows(data.events)
        .filter(
          (item) =>
            item.cancelled !== true &&
            (typeof item.endAt === "number" ? item.endAt : eventStart(item)) >= now,
        )
        .sort((a, b) => eventStart(a) - eventStart(b))[0];
      const start = event ? eventStart(event) : null;
      return {
        icon: "calendar",
        title: "캘린더",
        description: text(event?.title) || "예정된 일정이 없어요",
        value: start
          ? event?.allDay
            ? "종일"
            : new Date(start).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })
          : "",
        meta: data.error ? "이전 정보" : "",
      };
    }
    case "clock": {
      const anniversary = clockFeatured(data);
      return {
        icon: "clock",
        title: clockTime(data, now),
        description: "",
        value: anniversary ? anniversaryLabel(anniversary, now) : "",
        meta: anniversary ? text(anniversary.title) : "",
      };
    }
    case "weather":
      return {
        icon: "cloud",
        title: data.observation
          ? weatherTemperature(observation.temperature, weatherConfig(data))
          : "날씨",
        description: text(observation.name),
        value: data.observation ? weatherCondition(observation.weatherCode) : "",
        meta: !data.observation
          ? "아직 확인하지 않았어요"
          : data.status === "ready"
            ? ""
            : "이전 정보 · 갱신 필요",
      };
    case "focus-timer": {
      // Before a start, the row shows the same unsaved choice as the open timer.
      const draft = (text(data.status) || "idle") === "idle" ? readDraft(widget) : undefined;
      return {
        icon: "timer",
        title:
          data.status === "running"
            ? data.mode === "rest"
              ? "쉬는 중"
              : "집중 중"
            : data.status === "paused"
              ? "일시 정지"
              : data.status === "finished"
                ? data.mode === "rest"
                  ? "휴식 끝"
                  : "집중 끝"
                : "집중 준비",
        description: (draft ? draft.title : text(data.title)) || "집중할 일을 정해 주세요",
        value: countdown(
          draft ? Math.round(Number(draft.minutes) * 60000) || 0 : focusRemaining(widget, now),
        ),
        meta: "",
      };
    }
    case "music":
      return {
        icon: "music",
        title: text(observation.title) || "재생 중인 곡이 없어요",
        description: [text(observation.artist), text(observation.source)]
          .filter(Boolean)
          .join(" · "),
        value: `${musicTime(musicPosition(observation, now, musicIsFresh(data, now)))} / ${musicTime(finiteNumber(observation.durationMs))}`,
        meta: musicIsFresh(data, now) ? "" : "이전 정보",
      };
    case "preparation": {
      const { envelope, progress } = preparationState(widget, widgets, now);
      return {
        icon: "envelope",
        title: text(envelope?.title) || text(envelope?.eventLabel) || "준비 봉투가 없어요",
        description: [text(envelope?.date), "준비 봉투"].filter(Boolean).join(" · "),
        value: `${progress.completed}/${progress.total}`,
        meta: "",
      };
    }
    case "travel": {
      const line = record(data.line);
      return {
        icon: "plane",
        title: text(line.title) || "여행",
        description: text(line.description),
        value: text(line.value),
        meta: text(line.meta),
      };
    }
    case "memo": {
      const note = rows(data.notes).find((note) => note.isOpen) ?? rows(data.notes)[0];
      return {
        icon: "memo",
        title: text(note?.title) || "메모",
        description: text(note?.body),
        value: String(rows(data.notes).length),
        meta: "",
      };
    }
    default:
      return { icon: "box", title: "지원하지 않는 위젯", description: "", value: "", meta: "" };
  }
}

function preparationState(
  widget: WidgetView,
  widgets: readonly WidgetView[],
  now: number,
): {
  envelope: DataRecord | undefined;
  progress: ReturnType<typeof preparationProgress>;
} {
  const envelope = rows(record(widget.data).envelopes).find((item) => item.archived !== true);
  const todo = widgets.find((item) => item.kind === "todo");
  return {
    envelope,
    progress: preparationProgress(
      envelope ?? {},
      rows(record(todo?.data).items),
      localDay(new Date(now)),
    ),
  };
}

export function FreeformWidget({
  widget,
  widgets = [],
  now,
  interactive = true,
  ...appearance
}: {
  widget: WidgetView;
  widgets?: readonly WidgetView[];
  now: number;
  interactive?: boolean;
} & FreeformAppearanceProps): ReactElement {
  const [failure, setFailure] = useState<string | null>(null);
  const data = record(widget.data),
    observation = record(data.observation),
    summary = desktopSummary(widget, now, widgets);
  const look = { fallbackPreset: desktopSkin(widget.kind)?.fallbackPreset, ...appearance };
  switch (widget.kind) {
    case "todo":
    case "calendar":
    case "travel": {
      // The chip has room for one short value; the row uses the longer description instead.
      const chip = summary.value || (widget.kind === "travel" ? "여행" : "일정 없음");
      return (
        <div>
          <CompactFreeform
            {...look}
            icon={summary.icon}
            label={chip}
            aria-label={`${summary.title} ${chip}`}
            tabIndex={interactive ? undefined : -1}
            onClick={
              interactive
                ? () =>
                    void command("open_widget", { id: widget.id }).catch((cause: unknown) =>
                      setFailure(String(cause)),
                    )
                : undefined
            }
          />
          {failure && <p role="alert">{failure}</p>}
        </div>
      );
    }
    case "clock":
      return (
        <ClockWidget
          {...look}
          opaque
          time={summary.title.replace(/^(오전|오후)\s*/, "")}
          period={summary.title.match(/^(오전|오후)/)?.[1]}
          date={clockDate(data, now)}
          badge={summary.value || undefined}
        />
      );
    case "weather": {
      // Everything stays inside the cloud: the window is only the shape plus its margin.
      const config = weatherConfig(data);
      const details = config.showDetails
        ? [
            typeof observation.humidity === "number" ? `습도 ${observation.humidity}%` : "",
            typeof observation.windSpeed === "number"
              ? `바람 ${observation.windSpeed}${text(observation.windSpeedUnit)}`
              : "",
          ]
        : [];
      const apparent =
        config.showApparent && typeof observation.apparentTemperature === "number"
          ? `체감 ${weatherTemperature(observation.apparentTemperature, config)}`
          : "";
      return (
        <WeatherWidget
          {...look}
          opaque
          temperature={summary.title}
          condition={
            data.observation
              ? [summary.value, data.status === "ready" ? "" : "이전 정보", ...details]
                  .filter(Boolean)
                  .join(" · ")
              : "확인 필요"
          }
          location={[summary.description, apparent].filter(Boolean).join(" · ")}
        />
      );
    }
    case "focus-timer":
      return (
        <FocusTimerFreeform
          {...look}
          label={summary.title}
          task={summary.description}
          time={summary.value}
        />
      );
    case "music": {
      const art = artworkUrl(observation.artworkUrl);
      return (
        <MusicFreeform
          {...look}
          title={summary.title}
          artist={text(observation.artist)}
          caption={summary.meta ? "이전 정보" : "지금 듣는 곡"}
          elapsed={musicTime(musicPosition(observation, now, musicIsFresh(data, now)))}
          artwork={
            art ? (
              <img className={s.cover} src={art} alt="" referrerPolicy="no-referrer" />
            ) : undefined
          }
        />
      );
    }
    case "preparation": {
      const { envelope, progress } = preparationState(widget, widgets, now);
      return (
        <EnvelopeFreeform
          {...look}
          label="준비 봉투"
          title={summary.title}
          date={text(envelope?.date)}
          completed={progress.completed}
          total={progress.total}
        />
      );
    }
    case "memo": {
      const note = rows(data.notes).find((item) => item.isOpen === true) ?? rows(data.notes)[0];
      return (
        <MemoWidget {...look} title={summary.title}>
          <span style={{ fontSize: number(note?.fontSize) || 16, lineHeight: 1.6 }}>
            {summary.description || "아직 적은 내용이 없어요."}
          </span>
        </MemoWidget>
      );
    }
    default:
      return <p role="status">바탕화면에 놓을 수 없는 위젯이에요.</p>;
  }
}

/** Row styling per desktop kind; the icon always comes from the widget's own summary. */
const ROW_KINDS: Record<string, WidgetKind> = {
  clock: "clock",
  weather: "weather",
  "focus-timer": "focus",
  music: "music",
  preparation: "envelope",
  memo: "envelope",
  todo: "envelope",
  calendar: "envelope",
  travel: "envelope",
};

export function CollapsedDesktopWidget({
  widget,
  widgets = [],
  now,
  onExpand,
  expanded = false,
  editing = false,
  selected,
}: {
  widget: WidgetView;
  widgets?: readonly WidgetView[];
  now: number;
  onExpand: () => void;
  expanded?: boolean;
  editing?: boolean;
  selected?: boolean;
}): ReactElement {
  const summary = desktopSummary(widget, now, widgets);
  const period = widget.kind === "clock" ? summary.title.match(/^(오전|오후)\s*/)?.[1] : undefined;
  const fetched = widget.kind !== "weather" || Boolean(record(widget.data).observation);
  // Unfetched weather shows its name, not a temperature, so it keeps the regular title type.
  const kind = fetched ? (ROW_KINDS[widget.kind] ?? "envelope") : "envelope";
  let description: string | undefined = summary.description;
  let value: string | undefined = summary.value;
  let meta: ReactElement | string = summary.meta;
  if (widget.kind === "clock") {
    value = undefined;
    meta = (
      <>
        <strong>{summary.value}</strong>
        <br />
        {summary.meta}
      </>
    );
  }
  if (widget.kind === "weather") {
    description = undefined;
    value = undefined;
    meta = (
      <>
        <strong>{[summary.description, summary.value].filter(Boolean).join(" · ")}</strong>
        <br />
        {summary.meta}
      </>
    );
  }
  if (widget.kind === "music") {
    value = undefined;
    meta = (
      <>
        {summary.value}
        <br />
        {summary.meta}
      </>
    );
  }
  return (
    <WidgetRow
      kind={kind}
      icon={summary.icon}
      title={period ? summary.title.replace(/^(오전|오후)\s*/, "") : summary.title}
      period={period}
      description={description}
      value={value || undefined}
      meta={meta}
      phase={
        widget.kind === "focus-timer" && record(widget.data).status === "running"
          ? "running"
          : "ready"
      }
      layout={editing ? "editor" : "stack"}
      // Expanded rows sit inside the footer card, which owns the single outline.
      surface={expanded ? "plain" : "translucent"}
      style={{ width: "100%" }}
      aria-expanded={editing ? undefined : expanded}
      aria-pressed={editing ? Boolean(selected) : undefined}
      onClick={onExpand}
    />
  );
}

const STACK_ACTIONS: Record<string, { name: string; label: string; settings: boolean }> = {
  weather: { name: "날씨", label: "날씨 설정", settings: true },
  clock: { name: "시계", label: "시계 설정", settings: true },
  calendar: { name: "캘린더", label: "캘린더 열기", settings: false },
  todo: { name: "할 일", label: "할 일 열기", settings: false },
  memo: { name: "메모", label: "메모 열기", settings: false },
};

/** Kinds whose expanded stack row is the collapsed row in a card with a settings or open action. */
export function hasStackCard(kind: string): boolean {
  return kind in STACK_ACTIONS;
}
/** Kinds whose own window is the expanded view, so the capsule bar opens it directly. */
export function opensWidgetWindow(kind: string): boolean {
  return STACK_ACTIONS[kind]?.settings === false;
}

/** The settings or open action shown on a stacked widget; `null` for kinds without one. */
export function useStackAction(widget: WidgetView): {
  label: string;
  busy: boolean;
  error: string | null;
  open: () => void;
} | null {
  const { busy, error, run } = useConnectionCommand();
  const action = STACK_ACTIONS[widget.kind];
  if (!action) return null;
  function open(): void {
    if (action.settings) void run("open_planner_settings", { kind: widget.kind });
    else void run(...widgetWindowCommand(widget));
  }
  return { label: action.label, busy, error, open };
}

/** Opens the widget's own window; a memo opens its open note, or its first one. */
export function widgetWindowCommand(widget: WidgetView): [string, Record<string, unknown>] {
  const notes = widget.kind === "memo" ? rows(record(widget.data).notes) : [];
  const note = notes.find((item) => item.isOpen === true) ?? notes[0];
  return note
    ? ["open_memo_note", { id: widget.id, noteId: text(note.id) }]
    : ["open_widget", { id: widget.id }];
}

export function StackRowCard({
  widget,
  widgets = [],
  now,
  onCollapse,
}: {
  widget: WidgetView;
  widgets?: readonly WidgetView[];
  now: number;
  onCollapse: () => void;
}): ReactElement {
  return (
    <section className={s.stackCard} aria-label={STACK_ACTIONS[widget.kind]?.name ?? "위젯"}>
      <CollapsedDesktopWidget
        widget={widget}
        widgets={widgets}
        now={now}
        onExpand={onCollapse}
        expanded
      />
    </section>
  );
}

export function ExpandedDesktopWidget({
  widget,
  widgets,
  now,
  onCollapse,
  act,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  now: number;
  onCollapse: () => void;
  act: ToolAction;
}): ReactElement {
  const [failure, setFailure] = useState<string | null>(null);
  if (widget.kind === "focus-timer") {
    return (
      <TimerTool
        widget={widget}
        widgets={widgets}
        act={(action, input, target = widget) => act(action, input, target)}
        embedded
        onCollapse={onCollapse}
        busy={false}
        active
      />
    );
  }
  if (widget.kind === "music")
    return <MusicTool widget={widget} embedded onCollapse={onCollapse} />;
  if (widget.kind === "preparation") {
    const { envelope, progress } = preparationState(widget, widgets, now);
    const checks = rows(envelope?.checks);
    async function focus(): Promise<void> {
      if (!envelope) return;
      try {
        const timer = widgets.find(
          (item) => item.kind === "focus-timer",
        );
        if (!timer) {
          await command("open_planner_settings", { kind: "focus-timer" });
          return;
        }
        const calendar = widgets.find(
          (item) => item.kind === "calendar",
        );
        const event = rows(record(calendar?.data).events).find(
          (item) => item.id === envelope.eventId,
        );
        if (await act("start", preparationFocusInput(envelope, event, calendar), timer))
          await command("open_widget", { id: timer.id });
      } catch (cause: unknown) {
        setFailure(String(cause));
      }
    }
    return (
      <div className={s.expanded}>
        <EnvelopeWidget
          className={s.expanded}
          labels={{
            heading: "준비 봉투",
            progress: "봉투 준비 현황",
            count: (completed, total) => `${total}개 중 ${completed}개`,
            focus: "이 봉투로 집중",
            open: "봉투 열기",
          }}
          title={text(envelope?.title) || text(envelope?.eventLabel) || "준비 봉투가 없어요"}
          date={text(envelope?.date)}
          tasks={checks.map((check) => ({
            id: text(check.id),
            title: text(check.text),
            completed: check.done === true,
          }))}
          completedCount={progress.completed}
          totalCount={progress.total}
          onCollapse={onCollapse}
          onTaskChange={(checkId) => {
            if (envelope) void act("check-toggle", { id: text(envelope.id), checkId }, widget);
          }}
          onOpen={() =>
            void command("open_widget", { id: widget.id }).catch((cause: unknown) =>
              setFailure(String(cause)),
            )
          }
          onFocus={() => void focus()}
          footer={
            envelope
              ? `${rows(envelope.links).length}개 내용과 연결한 할 일은 봉투에서 봐요.`
              : "준비 봉투를 만들면 여기에 보여요."
          }
        />
        {failure && <p role="alert">{failure}</p>}
      </div>
    );
  }
  return <StackRowCard widget={widget} widgets={widgets} now={now} onCollapse={onCollapse} />;
}
