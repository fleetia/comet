import type { ReactElement } from "react";
import { Icon } from "@comet/icon";
import { Button, Checkbox, FormField, Select, TextInput } from "@comet/ui";
import { number, text } from "../toolData";
import { clockLabel, ruleOf } from "../Planner/plannerData";
import { FrequencyRecordAction } from "./FrequencyRecordAction";
import { FocusTimerAppUsage } from "./FocusTimerAppUsage";
import { FocusTimerView } from "./FocusTimerView";
import { countdown, focusDuration } from "./FocusTimerData";
import type { FocusTimerToolViewProps } from "./FocusTimerTool";
import type { FocusTimerSession } from "./useFocusTimerSession";
import type { FocusTimerLayout } from "./useFocusTimerLayout";
import type { FocusTimerContextState } from "./useFocusTimerContext";
import type { FocusTimerTodoCompletion } from "./useFocusTimerTodoCompletion";
import * as s from "./FocusTimer.css";

export function FocusTimerControls({
  tool,
  session,
  layout,
  panel,
  completion,
}: {
  tool: FocusTimerToolViewProps;
  session: FocusTimerSession;
  layout: FocusTimerLayout;
  panel: FocusTimerContextState;
  completion: FocusTimerTodoCompletion;
}): ReactElement {
  const { widget, act, onClose, onCollapse, embedded, busy, companionRows } = tool;
  const {
    data,
    now,
    draft,
    setDraft,
    custom,
    setCustom,
    timer,
    previousMemoPending,
    configure,
    start,
    saveMemo,
    transition,
    changeMemo,
  } = session;
  const {
    presentation,
    status,
    idle,
    completionPending,
    todo,
    tasks,
    selectedTodoId,
    linked,
    todoCompletionKey,
    remaining,
    progress,
    restDuration,
    longRestDuration,
    queue,
    statusLabel,
    todayDurations,
    activeRestDuration,
    phase,
    timeDescription,
    validDuration,
  } = timer;
  const { expanded, collapsed, resizeWidth, resize, expand } = layout;
  const { setTab, usagePickerOpen, setUsagePickerOpen, openSettings } = panel;
  const { completingTodo, completingTodoLock, completeTodo } = completion;
  return (
    <div className={s.timer}>
      <FocusTimerView
        wide={expanded || embedded}
        busy={busy}
        collapsed={collapsed}
        resizing={resizeWidth !== null}
        recordsOpen={expanded}
        custom={custom}
        pickerOpen={usagePickerOpen}
        onCollapse={() => {
          if (onCollapse) onCollapse();
          else void resize(expanded, true);
        }}
        onExpand={() => void resize(false)}
        onRecords={() => void expand()}
        onSettings={openSettings}
        onCloseWidget={onClose ? () => void onClose() : undefined}
        aria-label="타이머 조작"
        phase={phase}
        presentation={presentation}
        task={idle ? draft.title : text(data.title) || text(linked?.title) || "나만의 집중 시간"}
        time={countdown(remaining)}
        timeDescription={timeDescription}
        progress={progress}
        duration={Number(draft.minutes)}
        startDisabled={!validDuration && !(phase === "rest-complete" && queue.length > 0)}
        paused={status === "paused"}
        onTaskChange={(title) => setDraft({ ...draft, title })}
        onDurationChange={(minutes) => {
          if (minutes === 0) {
            setCustom(true);
            return;
          }
          setDraft({ ...draft, minutes: String(minutes) });
          setCustom(false);
        }}
        onStart={() => {
          if (idle) void start();
          else void transition("continue");
        }}
        onPause={() => void act(status === "paused" ? "resume" : "pause")}
        onStop={() => void transition("cancel")}
        onContinue={() => void transition("continue")}
        onSkipRest={() => void transition("continue")}
        onRest={
          phase === "complete" && !completionPending ? () => void transition("rest") : undefined
        }
        restLabel={`${focusDuration(restDuration)} 쉬기`}
        onLongRest={
          phase === "complete" && !completionPending
            ? () => void transition("rest", { kind: "long" })
            : undefined
        }
        longRestLabel={`길게 쉬기 (${focusDuration(longRestDuration)})`}
        nextTitle={text(queue[0]?.title)}
        note={draft.memo}
        noteLabel={previousMemoPending ? "이전 집중 메모" : "완료한 집중 메모"}
        onNoteChange={changeMemo}
        setup={
          <>
            <details className={s.sessionOptions}>
              <summary>이번 집중 연결</summary>
              <div>
                {todo && (
                  <FormField label="연결할 할 일" className={s.inlineField}>
                    <Select
                      fill
                      value={selectedTodoId}
                      disabled={busy}
                      onChange={(event) => setDraft({ ...draft, todoId: event.target.value })}
                    >
                      <option value="">연결하지 않음</option>
                      {tasks.map((task) => (
                        <option key={text(task.id)} value={text(task.id)}>
                          {text(task.title)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}
                <div className={s.row}>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      setTab("calendar");
                      if (!expanded) void expand();
                    }}
                  >
                    캘린더 일정 연결
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={busy}
                    onClick={() => setUsagePickerOpen(true)}
                  >
                    프로그램 사용 시간
                  </Button>
                </div>
              </div>
            </details>
            {custom && (
              <FormField label="집중 시간 (분)" className={s.inlineField}>
                <TextInput
                  fill
                  type="number"
                  min="0.02"
                  max="1440"
                  step="0.01"
                  value={draft.minutes}
                  onChange={(event) => setDraft({ ...draft, minutes: event.target.value })}
                />
              </FormField>
            )}
          </>
        }
        linked={
          idle ? (
            <>
              {draft.eventRef ? (
                <div className={s.linkedChip}>
                  <Icon name="calendar" size={13} />
                  <span>일정 · {text(draft.eventRef.title)}</span>
                  <Button
                    variant="ghost"
                    size="small"
                    aria-label="일정 연결 해제"
                    onClick={async () => {
                      if (await configure({ eventRef: null }))
                        setDraft({ ...draft, eventRef: null });
                    }}
                  >
                    ×
                  </Button>
                </div>
              ) : selectedTodoId ? (
                <div className={s.linkedChip}>
                  <Icon name="todo" size={13} />
                  <span>{text(tasks.find((task) => task.id === selectedTodoId)?.title)}</span>
                  <Button
                    variant="ghost"
                    size="small"
                    aria-label="할 일 연결 해제"
                    onClick={() => setDraft({ ...draft, todoId: "" })}
                  >
                    ×
                  </Button>
                </div>
              ) : null}
            </>
          ) : undefined
        }
        completion={
          phase === "complete" && linked && todo ? (
            ruleOf(linked).mode === "frequency" ? (
              <FrequencyRecordAction
                key={`${todo.id}:${text(linked.id)}:${text(ruleOf(linked).timeZone)}`}
                item={linked}
                todo={todo}
                now={now}
                act={act}
              />
            ) : (
              <Checkbox
                label={`${text(linked.title)} 완료로 표시`}
                checked={typeof linked.completedAt === "number"}
                disabled={
                  completingTodo ||
                  completingTodoLock.current === todoCompletionKey ||
                  typeof linked.completedAt === "number"
                }
                onChange={(event) => completeTodo(event, linked, todo, todoCompletionKey)}
              />
            )
          ) : undefined
        }
        summary={
          completionPending ? (
            <Button
              className={s.restSummary}
              variant="ghost"
              onClick={() => void transition("show-rest")}
            >
              휴식 {focusDuration(activeRestDuration)} 시작 ·{" "}
              {clockLabel(number(data.deadline) || now + remaining)}까지
            </Button>
          ) : phase === "rest-complete" ? (
            <div className={s.todaySummary}>
              <span>오늘 집중</span>
              <span className={s.todaySummaryValue}>
                {todayDurations.length}번 ·{" "}
                {focusDuration(todayDurations.reduce((total, elapsed) => total + elapsed, 0))}
              </span>
            </div>
          ) : undefined
        }
        afterControls={
          <>
            {previousMemoPending && (
              <div className={s.row}>
                <p className={s.quiet}>이전 집중의 저장하지 않은 메모가 있어요.</p>
                <Button variant="ghost" size="small" onClick={() => void saveMemo()}>
                  이전 집중 메모 저장
                </Button>
              </div>
            )}
            {status !== "running" && queue.length > 0 && (
              <p className={s.quiet}>다음 집중 '{text(queue[0].title)}'가 기다리고 있어요.</p>
            )}
            <p className={s.timerStatus} role="status">
              {statusLabel}
            </p>
            <FocusTimerAppUsage
              key={widget.id}
              data={data}
              act={act}
              onPickerChange={setUsagePickerOpen}
              pickerOpen={usagePickerOpen}
              hideUnconfigured
            />
          </>
        }
      />
      {expanded && !collapsed && !embedded && companionRows && (
        <fieldset className={s.companionRows} disabled={busy} aria-label="다른 바탕화면 위젯">
          {companionRows(now)}
        </fieldset>
      )}
    </div>
  );
}
