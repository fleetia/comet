import type { ReactElement, ReactNode } from "react";
import { Icon } from "@comet/icon";
import {
  Button,
  IconButton,
  SegmentedControl,
  TextInput,
  TimerCometTrail,
  WidgetRow,
  type FocusTimerWidgetProps,
} from "@comet/ui";
import * as s from "./FocusTimer.css";

export function FocusDial({
  time,
  description,
  progress = 1,
  presentation = "dial",
  rest = false,
  size = "regular",
}: {
  time: string;
  description?: string;
  progress?: number;
  presentation?: "dial" | "digits";
  rest?: boolean;
  size?: "regular" | "wide" | "preview";
}): ReactElement {
  const diameter = size === "preview" ? 196 : size === "wide" ? 188 : 168;
  const center = diameter / 2;
  const radius = center - 9;
  const amount = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const circumference = 2 * Math.PI * radius;
  const angle = -Math.PI / 2 + (1 - amount) * 2 * Math.PI;
  const point = { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius };
  return (
    <div
      className={s.dial}
      data-size={size}
      data-rest={rest}
      data-presentation={presentation}
      role="progressbar"
      aria-label="남은 집중 시간 비율"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(amount * 100)}
    >
      {presentation === "dial" && (
        <svg
          aria-hidden
          width={diameter}
          height={diameter}
          viewBox={`0 0 ${diameter} ${diameter}`}
          className={s.dialSvg}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            className={s.dialTrack}
            strokeWidth={8}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            className={s.dialArc}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${amount * circumference} ${circumference}`}
            transform={`rotate(${-90 + (1 - amount) * 360} ${center} ${center})`}
          />
          <TimerCometTrail center={center} radius={radius} angle={angle} />
          <circle cx={point.x} cy={point.y} r={13} className={s.dialGlow} />
          <circle cx={point.x} cy={point.y} r={6.5} className={s.dialPoint} />
        </svg>
      )}
      <div className={s.dialCopy}>
        <span role="timer" aria-label="남은 시간" className={s.dialTime}>
          {time}
        </span>
        {description && <span className={s.dialDescription}>{description}</span>}
      </div>
    </div>
  );
}

type Props = FocusTimerWidgetProps & {
  wide?: boolean;
  collapsed?: boolean;
  resizing?: boolean;
  recordsOpen?: boolean;
  onRecords: () => void;
  onSettings: () => void;
  linked?: ReactNode;
  custom?: boolean;
  pickerOpen?: boolean;
  onCloseWidget?: () => void;
  busy?: boolean;
  onLongRest?: () => void;
  longRestLabel?: string;
  nextTitle?: string;
};

export function FocusTimerView({
  phase = "ready",
  task,
  time,
  timeDescription,
  progress,
  duration = 25,
  presentation,
  paused,
  wide = false,
  collapsed = false,
  resizing = false,
  recordsOpen,
  onCollapse,
  onExpand,
  onRecords,
  onSettings,
  onTaskChange,
  onDurationChange,
  onStart,
  onPause,
  onStop,
  onContinue,
  onSkipRest,
  onRest,
  restLabel,
  onNoteChange,
  note,
  noteLabel,
  completion,
  summary,
  setup,
  linked,
  custom,
  pickerOpen,
  afterControls,
  startDisabled,
  className,
  onCloseWidget,
  busy,
  onLongRest,
  longRestLabel,
  nextTitle,
  ...props
}: Props): ReactElement {
  if (collapsed) {
    const titles = {
      ready: "집중 타이머",
      running: paused ? "집중 일시정지" : "집중 중",
      complete: "집중 끝",
      rest: "휴식 중",
      "rest-complete": "휴식 끝",
    };
    const descriptions = {
      ready: task ? `${task} · 시작 전` : "시작할 준비가 됐어요",
      running: task,
      complete: "할 일 완료를 꼭 눌러 주세요",
      rest: timeDescription,
      "rest-complete": "다시 시작할까요?",
    };
    return (
      <div className={s.compactTimerHost} data-closable={Boolean(onCloseWidget)}>
        <WidgetRow
          kind="focus"
          phase={phase}
          title={titles[phase]}
          description={descriptions[phase]}
          value={time}
          layout="flow"
          className={s.compactTimer}
          disabled={resizing || busy}
          aria-label="펼쳐 보기"
          onClick={onExpand}
        />
        {onCloseWidget && (
          <IconButton
            icon="close"
            aria-label="위젯 닫기"
            className={s.compactClose}
            onClick={onCloseWidget}
          />
        )}
      </div>
    );
  }
  return (
    <section
      {...props}
      className={[s.timerCard, className].filter(Boolean).join(" ")}
      data-wide={wide && !pickerOpen}
      data-phase={phase}
    >
      <fieldset className={s.controlFields} disabled={busy}>
        {!pickerOpen && (
          <>
            <header className={s.cardHeader}>
              <Icon name="timer" size={18} className={s.headerTimerIcon} />
              <h2 className={s.cardTitle}>집중 타이머</h2>
              <Button
                size="small"
                variant="ghost"
                className={s.collapseButton}
                disabled={resizing}
                onClick={onCollapse}
                trailingIcon={<Icon name="chevdown" size={15} />}
              >
                접기
              </Button>
            </header>
            {phase === "ready" && (
              <>
                <div className={s.timerSetup}>
                  <label className={s.timerLabel} htmlFor="focus-task">
                    무엇에 집중할까요?
                  </label>
                  <TextInput
                    id="focus-task"
                    aria-label="집중할 일"
                    value={task}
                    onChange={(event) => onTaskChange?.(event.target.value)}
                  />
                  {linked}
                </div>
                <FocusDial
                  time={time}
                  description={timeDescription}
                  progress={progress}
                  presentation={presentation}
                  size={wide ? "wide" : "regular"}
                />
                <SegmentedControl
                  label="집중 시간"
                  className={s.durationChoices}
                  value={!custom && [15, 25, 50].includes(duration) ? String(duration) : "custom"}
                  options={[
                    { value: "15", label: "15분" },
                    { value: "25", label: "25분" },
                    { value: "50", label: "50분" },
                    { value: "custom", label: "직접" },
                  ]}
                  onValueChange={(value) =>
                    value === "custom" ? onDurationChange?.(0) : onDurationChange?.(Number(value))
                  }
                />
                {setup}
                <Button className={s.primaryAction} disabled={startDisabled} onClick={onStart}>
                  집중 시작
                </Button>
                <p className={s.setupCaption}>끝나면 할 일을 완료할지 물어봐요</p>
              </>
            )}
            {(phase === "running" || phase === "rest") && (
              <>
                <div className={s.taskCopy}>
                  <span className={phase === "rest" ? s.restLabel : s.timerLabel}>
                    {phase === "rest" ? "휴식 중" : "지금 집중하는 일"}
                  </span>
                  <span className={s.taskTitle}>{phase === "rest" ? "잠깐 쉬어 가요" : task}</span>
                </div>
                <FocusDial
                  time={time}
                  description={timeDescription}
                  progress={progress}
                  presentation={presentation}
                  rest={phase === "rest"}
                  size={wide ? "wide" : "regular"}
                />
                <div className={s.timerActions}>
                  {phase === "running" ? (
                    <Button className={s.primaryAction} onClick={onPause}>
                      {paused ? "다시 시작" : "일시정지"}
                    </Button>
                  ) : (
                    <>
                      {paused && (
                        <Button className={s.linkAction} variant="ghost" onClick={onPause}>
                          다시 시작
                        </Button>
                      )}
                      <Button
                        className={s.linkAction}
                        variant="ghost"
                        trailingIcon={<Icon name="arrowright" size={14} />}
                        onClick={onSkipRest}
                      >
                        휴식 건너뛰기
                      </Button>
                    </>
                  )}
                  <Button
                    className={phase === "rest" ? s.linkAction : s.stopAction}
                    variant="ghost"
                    onClick={onStop}
                    trailingIcon={
                      phase === "rest" ? <Icon name="arrowright" size={14} /> : undefined
                    }
                  >
                    그만하기
                  </Button>
                </div>
              </>
            )}
            {(phase === "complete" || phase === "rest-complete") && (
              <>
                <div className={s.completeSymbol} data-rest-complete={phase === "rest-complete"}>
                  <Icon name={phase === "complete" ? "check" : "play"} size={34} />
                </div>
                <div className={s.completionCopy}>
                  <span className={s.completionTitle}>
                    {phase === "complete" ? "집중 시간이 끝났어요" : "다시 집중할 준비가 됐어요"}
                  </span>
                  <span className={s.dialDescription}>{timeDescription}</span>
                </div>
                {phase === "complete" ? (
                  <>
                    {completion && <div className={s.todoCompletion}>{completion}</div>}
                    <TextInput
                      aria-label={noteLabel}
                      placeholder="이번 집중 메모 남기기 (선택)"
                      value={note}
                      onChange={(event) => onNoteChange?.(event.target.value)}
                    />
                    {summary}
                    {onRest && (
                      <Button
                        className={s.restSummary}
                        variant="ghost"
                        onClick={onRest}
                        leadingIcon={<Icon name="moon" size={15} />}
                      >
                        {restLabel}
                      </Button>
                    )}
                    {onLongRest && (
                      <Button
                        className={s.restSummary}
                        variant="ghost"
                        onClick={onLongRest}
                        leadingIcon={<Icon name="moon" size={15} />}
                      >
                        {longRestLabel}
                      </Button>
                    )}
                    <div className={s.timerActions}>
                      <Button
                        className={s.linkAction}
                        variant="ghost"
                        onClick={onContinue}
                        trailingIcon={<Icon name="arrowright" size={14} />}
                      >
                        계속 집중
                      </Button>
                      <Button
                        className={s.linkAction}
                        variant="ghost"
                        onClick={onStop}
                        trailingIcon={<Icon name="arrowright" size={14} />}
                      >
                        오늘은 여기까지
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {summary}
                    <Button className={s.primaryAction} disabled={startDisabled} onClick={onStart}>
                      {nextTitle ? `${nextTitle} 집중 시작` : `${duration}분 다시 시작`}
                    </Button>
                    <Button className={s.stopAction} variant="ghost" onClick={onStop}>
                      오늘은 여기까지
                    </Button>
                  </>
                )}
              </>
            )}
          </>
        )}
        {afterControls}
        {!pickerOpen && (
          <footer className={s.timerFooter}>
            <p className={s.timerFooterText}>
              <Icon name={phase === "rest" ? "chat" : "moon"} size={15} />
              {phase === "rest"
                ? "쉬는 동안에는 친구들이 다시 말을 걸 수 있어요"
                : "집중하는 동안 친구들은 조용히 기다려요"}
            </p>
            <div className={s.timerActions}>
              <Button
                className={s.footerButton}
                size="small"
                variant={recordsOpen ? "selected" : "ghost"}
                disabled={resizing}
                leadingIcon={<Icon name="list" size={15} />}
                onClick={onRecords}
              >
                기록과 노트
              </Button>
              <Button
                className={s.footerButton}
                size="small"
                variant="ghost"
                leadingIcon={<Icon name="gear" size={15} />}
                onClick={onSettings}
              >
                집중 설정
              </Button>
            </div>
          </footer>
        )}
      </fieldset>
    </section>
  );
}
