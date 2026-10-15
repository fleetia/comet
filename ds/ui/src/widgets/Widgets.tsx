import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@comet/icon";
import { Button, Checkbox, Switch } from "../controls";
import * as styles from "./widgets.css";

export type WidgetKind = "focus" | "clock" | "weather" | "music" | "envelope";
export type WidgetSurface = "plain" | "translucent" | "glow";
export type WidgetLayout = "row" | "editor" | "stack" | "compact" | "desktop" | "flow";
export type FocusPhase = "ready" | "running" | "complete" | "rest" | "rest-complete";
const icons: Record<WidgetKind, IconName> = {
  focus: "timer",
  clock: "clock",
  weather: "cloud",
  music: "music",
  envelope: "envelope",
};
export type WidgetRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> & {
  kind: WidgetKind;
  title: string;
  description?: string;
  value?: ReactNode;
  meta?: ReactNode;
  layout?: WidgetLayout;
  surface?: WidgetSurface;
  phase?: FocusPhase;
};
export function WidgetRow({
  kind,
  title,
  description,
  value,
  meta,
  layout = "row",
  surface = "translucent",
  phase = "ready",
  className,
  type = "button",
  ...props
}: WidgetRowProps): JSX.Element {
  const isRest = phase === "rest" || phase === "complete";
  return (
    <button
      {...props}
      type={type}
      className={[
        styles.row,
        styles.layouts[layout],
        styles.surfaces[surface],
        kind === "focus" &&
          (phase === "running" || phase === "complete" || phase === "rest-complete") &&
          styles.active,
        kind === "focus" && isRest && styles.rest,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon name={kind === "focus" && phase === "rest" ? "moon" : icons[kind]} size={17} />
      <span className={styles.rowCopy}>
        <span
          className={[
            styles.rowTitle,
            (kind === "clock" || kind === "weather") && styles.rowClockTitle,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {title}
        </span>
        {description && <span className={styles.small}>{description}</span>}
      </span>
      {value !== undefined && (
        <span className={styles.rowValue}>
          {kind === "focus" && phase === "running" && (
            <span aria-hidden className={styles.liveDot} />
          )}
          {value}
        </span>
      )}
      {meta && <span className={styles.rowMeta}>{meta}</span>}
    </button>
  );
}

export type WidgetExpandedProps = HTMLAttributes<HTMLElement> & {
  title: string;
  icon?: IconName;
  onCollapse?: () => void;
  collapseLabel?: string;
  footer?: ReactNode;
};
export function WidgetExpanded({
  title,
  icon = "timer",
  onCollapse,
  collapseLabel = "접기",
  footer,
  children,
  className,
  ...props
}: WidgetExpandedProps): JSX.Element {
  return (
    <section
      {...props}
      aria-label={props["aria-label"] ?? title}
      className={[styles.panel, className].filter(Boolean).join(" ")}
    >
      <header className={styles.panelHeader}>
        <Icon name={icon} size={18} className={styles.headerIcon} />
        <h3 className={styles.panelTitle}>{title}</h3>
        {onCollapse && (
          <button type="button" onClick={onCollapse} className={styles.minorButton}>
            {collapseLabel}
            <Icon name="chev" size={12} style={{ transform: "rotate(-90deg)" }} />
          </button>
        )}
      </header>
      {children}
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}

export type WidgetSummaryItem = {
  id: string;
  icon: IconName;
  label: string;
  active?: boolean;
  live?: boolean;
  disabled?: boolean;
};
export type WidgetStackSummaryProps = HTMLAttributes<HTMLDivElement> & {
  items: readonly WidgetSummaryItem[];
  surface?: WidgetSurface;
  onSelect?: (id: string) => void;
};
export function WidgetStackSummary({
  items,
  surface = "translucent",
  onSelect,
  className,
  ...props
}: WidgetStackSummaryProps): JSX.Element {
  return (
    <div
      {...props}
      role="group"
      aria-label={props["aria-label"] ?? "위젯 모음"}
      className={[styles.summary, styles.surfaces[surface], className].filter(Boolean).join(" ")}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={item.disabled}
          aria-pressed={item.active}
          onClick={() => onSelect?.(item.id)}
          className={styles.summaryItem}
        >
          {item.live && <span aria-hidden className={styles.liveDot} />}
          <Icon name={item.icon} size={14} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
export const WidgetCollapsedBar = WidgetStackSummary;

export type TravelSummaryProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  title: string;
  description: string;
  countdown: string;
  phase?: "before" | "traveling" | "after";
};
export function TravelSummary({
  title,
  description,
  countdown,
  phase = "before",
  className,
  type = "button",
  ...props
}: TravelSummaryProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      className={[styles.row, styles.layouts.compact, className].filter(Boolean).join(" ")}
    >
      <Icon
        name={phase === "before" ? "plane" : phase === "traveling" ? "car" : "image"}
        size={18}
      />
      <span className={styles.rowCopy}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.small}>{description}</span>
      </span>
      <span className={styles.rowMeta}>
        <strong>{countdown}</strong>
        <br />
        <span className={styles.small}>{phase === "after" ? "다녀온 뒤" : "출발까지"}</span>
      </span>
    </button>
  );
}

export type FocusTimerWidgetProps = Omit<HTMLAttributes<HTMLElement>, "title" | "onChange"> & {
  phase?: FocusPhase;
  view?: "expanded" | "collapsed";
  title?: string;
  task: string;
  time: string;
  timeDescription?: string;
  progress?: number;
  duration?: number;
  durations?: readonly number[];
  onDurationChange?: (duration: number) => void;
  onTaskChange?: (task: string) => void;
  onStart?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onSkipRest?: () => void;
  onContinue?: () => void;
  onCollapse?: () => void;
  onExpand?: () => void;
  onNoteChange?: (note: string) => void;
  note?: string;
  completion?: ReactNode;
  summary?: ReactNode;
  footer?: ReactNode;
  paused?: boolean;
};

function TimerRing({
  time,
  description,
  progress = 0,
  rest = false,
  icon,
}: {
  time: string;
  description?: string;
  progress?: number;
  rest?: boolean;
  icon?: IconName;
}): JSX.Element {
  const amount = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const stroke = rest ? "var(--comet-color-byul-ink)" : "var(--comet-color-live)";
  return (
    <div className={styles.ring}>
      <svg aria-hidden width="160" height="160" viewBox="0 0 160 160" className={styles.ringSvg}>
        <circle
          cx="80"
          cy="80"
          r="72"
          fill="none"
          stroke="var(--comet-color-chip)"
          strokeWidth="7"
        />
        <circle
          cx="80"
          cy="80"
          r="72"
          fill="none"
          stroke={stroke}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${amount * 452.39} 452.39`}
        />
        <circle
          cx={80 + Math.cos(amount * 2 * Math.PI) * 72}
          cy={80 + Math.sin(amount * 2 * Math.PI) * 72}
          r="7"
          fill="var(--comet-color-comet)"
        />
      </svg>
      <span className={styles.ringCopy}>
        {icon ? <Icon name={icon} size={26} /> : <span className={styles.timer}>{time}</span>}
        {description && <span className={styles.small}>{description}</span>}
      </span>
    </div>
  );
}

export function FocusTimerWidget({
  phase = "ready",
  view = "expanded",
  title = "집중 타이머",
  task,
  time,
  timeDescription,
  progress = 0,
  duration = 25,
  durations = [15, 25, 50],
  onDurationChange,
  onTaskChange,
  onStart,
  onPause,
  onStop,
  onSkipRest,
  onContinue,
  onCollapse,
  onExpand,
  onNoteChange,
  note = "",
  completion,
  summary,
  footer,
  paused = false,
  className,
  ...props
}: FocusTimerWidgetProps): JSX.Element {
  const isComplete = phase === "complete";
  const isRest = phase === "rest";
  const isRestComplete = phase === "rest-complete";
  if (view === "collapsed") {
    const phaseTitles = {
      ready: title,
      running: "집중 중",
      complete: "집중 끝",
      rest: "휴식 중",
      "rest-complete": "휴식 끝",
    };
    return (
      <WidgetRow
        {...props}
        kind="focus"
        title={phaseTitles[phase]}
        description={task}
        value={time}
        phase={phase}
        layout="flow"
        className={className}
        onClick={onExpand ?? onCollapse}
      />
    );
  }
  return (
    <WidgetExpanded
      {...props}
      title={title}
      icon="timer"
      onCollapse={onCollapse}
      className={className}
      footer={
        footer ??
        (isRest
          ? "쉬는 동안에는 친구들이 다시 말을 걸 수 있어요"
          : "집중하는 동안 친구들은 조용히 기다려요")
      }
    >
      {phase === "ready" && (
        <>
          <label className={styles.small}>
            무엇에 집중할까요?
            <input
              className={styles.note}
              value={task}
              onChange={(event) => onTaskChange?.(event.currentTarget.value)}
              readOnly={!onTaskChange}
            />
          </label>
          {completion}
          <TimerRing time={time} description={timeDescription} progress={progress} />
          <div role="group" aria-label="집중 시간" className={styles.durations}>
            {durations.map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={duration === minutes}
                onClick={() => onDurationChange?.(minutes)}
                className={styles.duration}
              >
                {minutes}분
              </button>
            ))}
          </div>
          <Button onClick={onStart}>집중 시작</Button>
          <span className={styles.small} style={{ textAlign: "center" }}>
            끝내면 할 일을 완료하지 말아요
          </span>
        </>
      )}
      {phase === "running" && (
        <>
          <span className={styles.small}>지금 집중하는 일</span>
          <div className={styles.task}>{task}</div>
          <TimerRing time={time} description={timeDescription} progress={progress} />
          <div className={styles.actions}>
            <Button size="small" onClick={onPause}>
              {paused ? "다시 시작" : "일시정지"}
            </Button>
            <Button size="small" variant="ghost" onClick={onStop}>
              그만하기
            </Button>
          </div>
        </>
      )}
      {isComplete && (
        <>
          <div className={styles.completed}>
            <span className={styles.completionIcon}>
              <Icon name="check" size={32} />
            </span>
            <span className={styles.task}>집중 시간이 끝났어요</span>
            <span className={styles.small}>{timeDescription}</span>
          </div>
          {completion}
          <input
            aria-label="이번 집중 메모"
            placeholder="이번 집중 메모 남기기 (선택)"
            value={note}
            readOnly={!onNoteChange}
            onChange={(event) => onNoteChange?.(event.currentTarget.value)}
            className={styles.note}
          />
          {summary}
          <div className={styles.actions}>
            <Button size="small" variant="ghost" onClick={onContinue}>
              계속 집중
            </Button>
            <Button size="small" variant="ghost" onClick={onStop}>
              오늘은 여기까지
            </Button>
          </div>
        </>
      )}
      {isRest && (
        <>
          <span className={styles.small}>휴식 중</span>
          <span className={styles.task}>잠깐 쉬어 가요</span>
          <TimerRing time={time} description={timeDescription} progress={progress} rest />
          <div className={styles.actions}>
            <Button size="small" variant="ghost" onClick={onSkipRest}>
              휴식 건너뛰기
            </Button>
            <Button size="small" variant="ghost" onClick={onStop}>
              그만하기
            </Button>
          </div>
        </>
      )}
      {isRestComplete && (
        <>
          <div className={styles.completed}>
            <span className={[styles.completionIcon, styles.restartIcon].join(" ")}>
              <Icon name="play" size={30} />
            </span>
            <span className={styles.task}>다시 집중할 준비가 됐어요</span>
            <span className={styles.small}>쉬는 시간 5분이 끝났어요</span>
          </div>
          {summary}
          <Button onClick={onStart}>{duration}분 다시 시작</Button>
          <Button variant="ghost" onClick={onStop}>
            오늘은 여기까지
          </Button>
        </>
      )}
    </WidgetExpanded>
  );
}

export type MusicWidgetProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: string;
  artist: string;
  elapsed: string;
  duration?: string;
  progress?: number;
  artwork?: ReactNode;
  onCollapse?: () => void;
  onDiscuss?: () => void;
  onOpenPlayer?: () => void;
  shareEnabled?: boolean;
  onShareChange?: (enabled: boolean) => void;
};
export function MusicWidget({
  title,
  artist,
  elapsed,
  duration,
  progress = 0,
  artwork,
  onCollapse,
  onDiscuss,
  onOpenPlayer,
  shareEnabled = false,
  onShareChange,
  ...props
}: MusicWidgetProps): JSX.Element {
  return (
    <WidgetExpanded
      {...props}
      title="음악 정보"
      icon="music"
      onCollapse={onCollapse}
      style={{ width: 352, ...props.style }}
      footer="곡 정보만 읽어요. 재생과 음량은 음악 앱에서 바꿔요."
    >
      <div className={styles.song}>
        <span className={styles.cover}>{artwork ?? <Icon name="music" size={26} />}</span>
        <span className={styles.rowCopy}>
          <strong className={styles.songTitle}>{title}</strong>
          <span>{artist}</span>
          <span className={styles.small}>조용한 궤도</span>
        </span>
      </div>
      <progress
        aria-label="음악 재생 위치"
        max={1}
        value={Math.max(0, Math.min(1, progress))}
        className={styles.progress}
      />
      <div className={styles.actions}>
        <span className={styles.small}>{elapsed}</span>
        <span className={styles.small} style={{ marginLeft: "auto" }}>
          {duration}
        </span>
      </div>
      <div className={styles.actions}>
        <Button size="small" variant="ghost" onClick={onDiscuss}>
          이 곡 이야기하기
        </Button>
        <button type="button" className={styles.minorButton} onClick={onOpenPlayer}>
          음악 앱 열기
        </button>
      </div>
      <div
        className={styles.actions}
        style={{ borderTop: "1px solid var(--comet-color-divider)", paddingTop: 10 }}
      >
        <span className={styles.rowCopy}>
          친구들이 이 곡 이야기하기
          <span className={styles.small}>곡 제목과 아티스트만 대화에 써요</span>
        </span>
        <Switch
          aria-label="친구들이 이 곡 이야기하기"
          checked={shareEnabled}
          onChange={(event) => onShareChange?.(event.currentTarget.checked)}
        />
      </div>
    </WidgetExpanded>
  );
}

export type EnvelopeTask = { id: string; title: string; completed?: boolean; description?: string };
export type EnvelopeWidgetProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: string;
  date: string;
  tasks: readonly EnvelopeTask[];
  onTaskChange?: (id: string, completed: boolean) => void;
  onCollapse?: () => void;
  onFocus?: () => void;
  onOpen?: () => void;
};
export function EnvelopeWidget({
  title,
  date,
  tasks,
  onTaskChange,
  onCollapse,
  onFocus,
  onOpen,
  ...props
}: EnvelopeWidgetProps): JSX.Element {
  const completed = tasks.filter((task) => task.completed).length;
  return (
    <WidgetExpanded
      {...props}
      title="준비 봉투"
      icon="envelope"
      onCollapse={onCollapse}
      style={{ width: 370, ...props.style }}
      footer="내용 4개는 봉투에서 봐요. 끝난 일정은 빠고 가까운 날짜의 봉투부터 보여 줘요."
    >
      <span className={styles.task}>{title}</span>
      <span className={styles.small}>{date}</span>
      <progress
        aria-label="봉투 준비 현황"
        max={Math.max(tasks.length, 1)}
        value={completed}
        className={styles.progress}
      />
      <span className={styles.small} style={{ textAlign: "right" }}>
        {tasks.length}개 중 {completed}개
      </span>
      <div>
        {tasks.map((task) => (
          <div key={task.id} className={styles.envelopeTask}>
            <Checkbox
              label={task.title}
              checked={task.completed ?? false}
              onChange={(event) => onTaskChange?.(task.id, event.currentTarget.checked)}
            />
            {task.description && <span className={styles.small}>{task.description}</span>}
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <Button size="small" variant="ghost" onClick={onFocus}>
          이 봉투로 집중
        </Button>
        <Button size="small" variant="ghost" onClick={onOpen}>
          봉투 열기
        </Button>
      </div>
    </WidgetExpanded>
  );
}

export type AppUsageOption = { id: string; name: string; icon?: ReactNode; disabled?: boolean };
export type AppUsagePickerProps = HTMLAttributes<HTMLDivElement> & {
  options: readonly AppUsageOption[];
  value: string;
  onValueChange?: (value: string) => void;
  name?: string;
  onSave?: () => void;
  onRefresh?: () => void;
  description?: string;
};
export function AppUsagePicker({
  options,
  value,
  onValueChange,
  name,
  onSave,
  onRefresh,
  description = "맨 앞에서 1분 안에 입력할 때만 세요. 창 제목이나 내용은 읽지 않아요.",
  className,
  ...props
}: AppUsagePickerProps): JSX.Element {
  const generatedName = useId();
  return (
    <div {...props} className={[styles.stack, className].filter(Boolean).join(" ")}>
      <fieldset className={styles.picker}>
        <legend
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clipPath: "inset(50%)",
          }}
        >
          측정할 프로그램
        </legend>
        {options.map((option) => (
          <label key={option.id} className={styles.pickerOption}>
            <input
              type="radio"
              name={name ?? generatedName}
              value={option.id}
              checked={value === option.id}
              disabled={option.disabled}
              onChange={() => onValueChange?.(option.id)}
              className={styles.nativeRadio}
            />
            {option.icon}
            {option.name}
          </label>
        ))}
      </fieldset>
      <span className={styles.small}>{description}</span>
      <div className={styles.actions}>
        {onRefresh && (
          <Button variant="ghost" className={styles.stretch} onClick={onRefresh}>
            새로고침
          </Button>
        )}
        {onSave && (
          <Button className={styles.stretch} onClick={onSave}>
            저장
          </Button>
        )}
      </div>
    </div>
  );
}

export type AppUsageSummaryProps = HTMLAttributes<HTMLDivElement> & {
  program?: string;
  onChoose?: () => void;
};
export function AppUsageSummary({
  program,
  onChoose,
  className,
  ...props
}: AppUsageSummaryProps): JSX.Element {
  return (
    <div
      {...props}
      className={[styles.picker, className].filter(Boolean).join(" ")}
      style={{ padding: 12, gap: 4, ...props.style }}
    >
      <div className={styles.actions}>
        <span className={styles.small} style={{ flex: 1 }}>
          앱 전면 사용
        </span>
        <button type="button" className={styles.minorButton} onClick={onChoose}>
          고르기...
        </button>
      </div>
      <strong>{program ?? "선택한 프로그램 없음"}</strong>
      <span className={styles.small}>한 프로그램의 사용 시간을 따로 세요</span>
    </div>
  );
}

export type WidgetCreationProgressProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  request?: string;
  steps: readonly { id: string; label: string; state: "pending" | "active" | "complete" }[];
  onCancel?: () => void;
};
export function WidgetCreationProgress({
  title = "AI가 만들고 있어요...",
  request,
  steps,
  onCancel,
  className,
  ...props
}: WidgetCreationProgressProps): JSX.Element {
  return (
    <div {...props} role="status" className={[styles.stack, className].filter(Boolean).join(" ")}>
      <TimerRing time="" progress={0.65} icon="wand" />
      <strong style={{ textAlign: "center" }}>{title}</strong>
      {request && (
        <span className={styles.small} style={{ textAlign: "center" }}>
          {request}
        </span>
      )}
      <ul className={styles.picker} style={{ listStyle: "none", padding: 12, gap: 8 }}>
        {steps.map((step) => (
          <li key={step.id} className={styles.actions}>
            {step.state === "complete" ? (
              <Icon name="check" size={18} />
            ) : (
              <span
                aria-hidden
                style={{
                  width: 16,
                  height: 16,
                  border: "1px dotted currentColor",
                  borderRadius: "50%",
                  background: step.state === "active" ? "var(--comet-color-live)" : "transparent",
                }}
              />
            )}
            {step.label}
          </li>
        ))}
      </ul>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel}>
          멈추기
        </Button>
      )}
    </div>
  );
}
