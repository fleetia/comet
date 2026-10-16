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
import { TimerCometTrail } from "./TimerCometTrail";

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
  icon?: IconName;
  title: string;
  period?: string;
  description?: string;
  value?: ReactNode;
  meta?: ReactNode;
  layout?: WidgetLayout;
  surface?: WidgetSurface;
  phase?: FocusPhase;
};
export function WidgetRow({
  kind,
  icon,
  title,
  period,
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
      <Icon
        name={icon ?? (kind === "focus" && phase === "rest" ? "moon" : icons[kind])}
        size={layout === "editor" ? 19 : 17}
        className={kind === "clock" ? styles.rowClockIcon : undefined}
      />
      <span
        className={[styles.rowCopy, kind === "clock" && styles.rowClockCopy]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          className={[
            styles.rowTitle,
            (kind === "clock" || kind === "weather") && styles.rowClockTitle,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {title}
          {period && <small className={styles.rowPeriod}>{period}</small>}
        </span>
        {description && <span className={styles.small}>{description}</span>}
      </span>
      {value !== undefined && (
        <span
          className={[
            styles.rowValue,
            (kind === "envelope" || kind === "music") && styles.rowTextValue,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {kind === "focus" && phase === "running" && (
            <span aria-hidden className={styles.rowLiveDot} />
          )}
          {value}
        </span>
      )}
      {meta && (
        <span
          className={[styles.rowMeta, kind === "clock" && styles.rowClockMeta]
            .filter(Boolean)
            .join(" ")}
        >
          {meta}
        </span>
      )}
      {layout === "editor" && (
        <Icon
          name="grip"
          size={18}
          className={kind === "clock" ? styles.rowClockIcon : undefined}
        />
      )}
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
export type WidgetStackSummaryProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
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
          <Icon name={item.icon} size={15} />
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
  presentation?: "dial" | "digits";
  taskInputLabel?: string;
  setup?: ReactNode;
  customDuration?: ReactNode;
  afterControls?: ReactNode;
  startDisabled?: boolean;
  onDurationChange?: (duration: number) => void;
  onTaskChange?: (task: string) => void;
  onStart?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onSkipRest?: () => void;
  onContinue?: () => void;
  onRest?: () => void;
  restLabel?: string;
  onCollapse?: () => void;
  onExpand?: () => void;
  onNoteChange?: (note: string) => void;
  onNoteBlur?: () => void;
  noteLabel?: string;
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
  presentation = "dial",
  icon,
}: {
  time: string;
  description?: string;
  progress?: number;
  rest?: boolean;
  presentation?: "dial" | "digits";
  icon?: IconName;
}): JSX.Element {
  const amount = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const stroke = rest ? "var(--comet-color-byul-ink)" : "var(--comet-color-live)";
  return (
    <div
      className={presentation === "digits" ? styles.digits : styles.ring}
      role="progressbar"
      aria-label="남은 집중 시간 비율"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(amount * 100)}
    >
      {presentation === "dial" && (
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
          <TimerCometTrail center={80} radius={72} angle={amount * 2 * Math.PI} />
          <circle
            cx={80 + Math.cos(amount * 2 * Math.PI) * 72}
            cy={80 + Math.sin(amount * 2 * Math.PI) * 72}
            r="7"
            fill="var(--comet-color-comet)"
          />
        </svg>
      )}
      <span className={styles.ringCopy}>
        {icon ? (
          <Icon name={icon} size={26} />
        ) : (
          <span role="timer" aria-label="남은 시간" className={styles.timer}>
            {time}
          </span>
        )}
        {description && <span className={styles.small}>{description}</span>}
      </span>
    </div>
  );
}

export type FocusTimerPreviewProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  time: string;
  presentation?: "dial" | "digits";
  description?: string;
};
export function FocusTimerPreview({
  time,
  presentation = "dial",
  description = "기본 집중 시간",
  ...props
}: FocusTimerPreviewProps): JSX.Element {
  return (
    <WidgetExpanded {...props} title="집중 타이머" icon="timer">
      <TimerRing time={time} description={description} presentation={presentation} progress={1} />
    </WidgetExpanded>
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
  presentation = "dial",
  taskInputLabel = "무엇에 집중할까요?",
  setup,
  customDuration,
  afterControls,
  startDisabled = false,
  onDurationChange,
  onTaskChange,
  onStart,
  onPause,
  onStop,
  onSkipRest,
  onContinue,
  onRest,
  restLabel = "휴식 시작",
  onCollapse,
  onExpand,
  onNoteChange,
  onNoteBlur,
  noteLabel = "이번 집중 메모",
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
            {taskInputLabel}
            <input
              aria-label="집중할 일"
              className={styles.note}
              value={task}
              onChange={(event) => onTaskChange?.(event.currentTarget.value)}
              readOnly={!onTaskChange}
            />
          </label>
          {completion}
          <TimerRing
            time={time}
            description={timeDescription}
            progress={progress}
            presentation={presentation}
          />
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
            {customDuration}
          </div>
          {setup}
          <Button onClick={onStart} disabled={startDisabled}>
            집중 시작
          </Button>
          <span className={styles.small} style={{ textAlign: "center" }}>
            끝나면 할 일을 완료할지 물어봐요
          </span>
        </>
      )}
      {phase === "running" && (
        <>
          <span className={styles.small}>지금 집중하는 일</span>
          <div className={styles.task}>{task}</div>
          <TimerRing
            time={time}
            description={timeDescription}
            progress={progress}
            presentation={presentation}
          />
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
            aria-label={noteLabel}
            placeholder="이번 집중 메모 남기기 (선택)"
            value={note}
            readOnly={!onNoteChange}
            onChange={(event) => onNoteChange?.(event.currentTarget.value)}
            onBlur={onNoteBlur}
            className={styles.note}
          />
          {summary}
          {onRest && (
            <Button size="small" variant="ghost" onClick={onRest}>
              {restLabel}
            </Button>
          )}
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
          <TimerRing
            time={time}
            description={timeDescription}
            progress={progress}
            presentation={presentation}
            rest
          />
          <div className={styles.actions}>
            {onPause && (
              <Button size="small" onClick={onPause}>
                {paused ? "다시 시작" : "일시정지"}
              </Button>
            )}
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
            <span className={styles.small}>{timeDescription ?? "쉬는 시간이 끝났어요"}</span>
          </div>
          {summary}
          <Button onClick={onStart} disabled={startDisabled}>
            {duration}분 다시 시작
          </Button>
          <Button variant="ghost" onClick={onStop}>
            오늘은 여기까지
          </Button>
        </>
      )}
      {afterControls}
    </WidgetExpanded>
  );
}

/** Copy the app supplies for the music card; each string is also its control's accessible name. */
export type MusicWidgetLabels = {
  heading: string;
  progress: string;
  discuss: string;
  /** Visible text of the player link, such as the player's name. */
  openPlayer: string;
  /** Accessible name of the player link. */
  openPlayerAccessible: string;
  share: string;
  shareDescription: string;
  disclaimer: string;
  settings: string;
};
export type MusicWidgetProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: string;
  artist: string;
  album?: string;
  source?: string;
  labels: MusicWidgetLabels;
  busy?: boolean;
  elapsed: string;
  duration?: string;
  progress?: number;
  artwork?: ReactNode;
  showArtwork?: boolean;
  onCollapse?: () => void;
  onDiscuss?: () => void;
  onOpenPlayer?: () => void;
  onSettings?: () => void;
  shareEnabled?: boolean;
  onShareChange?: (enabled: boolean) => void;
};
export function MusicWidget({
  title,
  artist,
  album,
  source,
  labels,
  busy = false,
  elapsed,
  duration,
  progress = 0,
  artwork,
  showArtwork = true,
  onCollapse,
  onDiscuss,
  onOpenPlayer,
  onSettings,
  shareEnabled = false,
  onShareChange,
  className,
  ...props
}: MusicWidgetProps): JSX.Element {
  return (
    <WidgetExpanded
      {...props}
      className={[styles.musicCard, className].filter(Boolean).join(" ")}
      title={labels.heading}
      icon="music"
      onCollapse={onCollapse}
      style={{ width: 370, ...props.style }}
    >
      <div className={[styles.song, styles.musicSong].join(" ")}>
        {showArtwork && (
          <span className={styles.cover}>{artwork ?? <Icon name="music" size={28} />}</span>
        )}
        <span className={styles.musicCopy}>
          <strong className={styles.musicTitle}>{title}</strong>
          <span className={styles.musicArtist}>{artist}</span>
          {album && <span className={styles.musicAlbum}>{album}</span>}
        </span>
      </div>
      <div className={styles.musicProgress}>
        <progress
          aria-label={labels.progress}
          max={1}
          value={Math.max(0, Math.min(1, progress))}
          className={styles.progress}
        />
        <div className={styles.musicTimes}>
          <span>{elapsed}</span>
          <span className={styles.musicSource}>{source}</span>
          <span>{duration}</span>
        </div>
      </div>
      <div className={styles.musicActions}>
        <Button
          className={styles.musicDiscuss}
          size="small"
          variant="ghost"
          leadingIcon={<Icon name="chat" size={15} />}
          onClick={onDiscuss}
          disabled={busy || !onDiscuss}
        >
          {labels.discuss}
        </Button>
        <button
          type="button"
          className={styles.musicLink}
          aria-label={labels.openPlayerAccessible}
          onClick={onOpenPlayer}
          disabled={busy || !onOpenPlayer}
        >
          {labels.openPlayer}
          <span aria-hidden> ↗</span>
        </button>
      </div>
      <div className={styles.musicFooter}>
        <div className={styles.musicShare}>
          <span className={styles.musicShareCopy}>
            {labels.share}
            <span>{labels.shareDescription}</span>
          </span>
          <Switch
            aria-label={labels.share}
            checked={shareEnabled}
            disabled={busy || !onShareChange}
            onChange={(event) => onShareChange?.(event.currentTarget.checked)}
          />
        </div>
        <div className={styles.musicDisclaimer}>
          <span>{labels.disclaimer} </span>
          <button
            type="button"
            className={styles.musicLink}
            onClick={onSettings}
            disabled={busy || !onSettings}
          >
            {labels.settings}
          </button>
        </div>
      </div>
    </WidgetExpanded>
  );
}

export type EnvelopeTask = { id: string; title: string; completed?: boolean; description?: string };
/** Copy the app supplies for the envelope card. */
export type EnvelopeWidgetLabels = {
  heading: string;
  /** Accessible name of the progress bar. */
  progress: string;
  /** Visible progress summary, such as "9개 중 2개". */
  count: (completed: number, total: number) => ReactNode;
  focus: string;
  open: string;
};
export type EnvelopeWidgetProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: string;
  labels: EnvelopeWidgetLabels;
  date: string;
  tasks: readonly EnvelopeTask[];
  onTaskChange?: (id: string, completed: boolean) => void;
  onCollapse?: () => void;
  onFocus?: () => void;
  onOpen?: () => void;
  footer?: ReactNode;
  completedCount?: number;
  totalCount?: number;
};
export function EnvelopeWidget({
  title,
  labels,
  date,
  tasks,
  onTaskChange,
  onCollapse,
  onFocus,
  onOpen,
  footer,
  completedCount,
  totalCount,
  ...props
}: EnvelopeWidgetProps): JSX.Element {
  const completed = completedCount ?? tasks.filter((task) => task.completed).length;
  const total = totalCount ?? tasks.length;
  return (
    <WidgetExpanded
      {...props}
      title={labels.heading}
      icon="envelope"
      onCollapse={onCollapse}
      style={{ width: 370, ...props.style }}
      footer={footer}
    >
      <span className={styles.task}>{title}</span>
      <span className={styles.small}>{date}</span>
      <progress
        aria-label={labels.progress}
        max={Math.max(total, 1)}
        value={completed}
        className={styles.progress}
      />
      <span className={styles.small} style={{ textAlign: "right" }}>
        {labels.count(completed, total)}
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
          {labels.focus}
        </Button>
        <Button size="small" variant="ghost" onClick={onOpen}>
          {labels.open}
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
