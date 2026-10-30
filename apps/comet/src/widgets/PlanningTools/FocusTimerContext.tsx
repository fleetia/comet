import type { ReactElement } from "react";
import { Button, SegmentedControl } from "@comet/ui";
import { localDay, text } from "../toolData";
import { FocusTimerCalendar } from "./FocusTimerCalendar";
import { FocusTimerNotes } from "./FocusTimerNotes";
import { FocusTimerQueue } from "./FocusTimerQueue";
import { FocusTimerStats } from "./FocusTimerStats";
import { countdown } from "./FocusTimerData";
import type { FocusTimerToolViewProps } from "./FocusTimerTool";
import type { FocusTimerSession } from "./useFocusTimerSession";
import type { FocusTimerLayout } from "./useFocusTimerLayout";
import type { FocusTimerContextState } from "./useFocusTimerContext";
import * as s from "./FocusTimer.css";

export function FocusTimerContext({
  tool,
  session,
  layout,
  panel,
}: {
  tool: FocusTimerToolViewProps;
  session: FocusTimerSession;
  layout: FocusTimerLayout;
  panel: FocusTimerContextState;
}): ReactElement {
  const { widgets, act, active, busy } = tool;
  const {
    data,
    now,
    draft,
    memoBase,
    timer,
    previousMemoPending,
    previousMemoSession,
    prepareEvent,
    connectNote,
    saveMemo,
    changeMemo,
    reloadMemo,
  } = session;
  const { idle, calendar, tasks, remaining, sessions } = timer;
  const { expanded, resize } = layout;
  const {
    tab,
    setTab,
    selectedSession,
    setSelectedSession,
    requestedNote,
    setRequestedNote,
    recordNoteButton,
    openNote,
    closeRequestedNote,
    openTimeline,
  } = panel;
  return (
    <aside
      ref={layout.context}
      className={s.context}
      aria-label="일정과 집중 기록"
      tabIndex={-1}
      inert={!expanded}
    >
      <fieldset disabled={busy} className={s.controlFields}>
        <SegmentedControl
          label="집중 패널"
          value={tab}
          options={[
            { value: "calendar", label: "일정" },
            { value: "stats", label: "기록" },
            { value: "notes", label: "노트" },
            { value: "queue", label: "다음 집중" },
          ]}
          onValueChange={setTab}
        />
        {tab === "queue" && (
          <FocusTimerQueue data={data} tasks={tasks} act={act} defaultMinutes={draft.minutes} />
        )}
        {tab === "calendar" && (
          <div className={s.tabPanel}>
            <Button variant="ghost" size="small" onClick={() => setTab("stats")}>
              집중 기록으로
            </Button>
            <FocusTimerCalendar
              calendar={calendar}
              act={act}
              canPrepare={idle}
              title={draft.title}
              durationMs={Math.round(Number(draft.minutes) * 60000)}
              noteRef={draft.noteRef}
              linkedEvent={draft.eventRef}
              sessions={sessions}
              onPrepare={prepareEvent}
              onSession={(session) => {
                setSelectedSession(session.id);
                setTab("stats");
              }}
            />
          </div>
        )}
        {tab === "stats" && (
          <div className={s.tabPanel}>
            <FocusTimerStats
              hideTabs
              sessions={sessions}
              day={localDay(new Date(now))}
              selectedId={selectedSession}
              noteButtonRef={recordNoteButton}
              onSelect={setSelectedSession}
              onNotes={() => setTab("notes")}
              onClose={() => void resize(false)}
              onOpenTimeline={openTimeline}
              act={act}
              onOpenNote={openNote}
            />
          </div>
        )}
        {tab === "notes" && (
          <div className={s.tabPanel}>
            <FocusTimerNotes
              hideTabs
              active={active}
              widgets={widgets}
              noteRef={draft.noteRef}
              memo={draft.memo}
              memoBase={memoBase}
              sessionLabel={previousMemoPending ? "이전 집중" : undefined}
              sessionTitle={
                previousMemoPending
                  ? text(previousMemoSession?.title)
                  : idle
                    ? draft.title
                    : text(data.title)
              }
              sessionTime={previousMemoPending ? undefined : countdown(remaining)}
              act={act}
              onClose={() => void resize(false)}
              memoConflict={
                draft.memo !== memoBase &&
                (previousMemoPending
                  ? !previousMemoSession || text(previousMemoSession.memo) !== memoBase
                  : text(data.memo) !== memoBase)
              }
              onReloadMemo={reloadMemo}
              canConnect={idle && active}
              requested={requestedNote}
              onRequestedHandled={() => setRequestedNote(null)}
              onRequestedNoteClose={closeRequestedNote}
              onConnect={connectNote}
              onMemoChange={changeMemo}
              onSaveMemo={saveMemo}
              onRecords={() => setTab("stats")}
            />
          </div>
        )}
      </fieldset>
    </aside>
  );
}
