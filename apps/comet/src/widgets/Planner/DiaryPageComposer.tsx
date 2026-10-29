import { Button, Select, TextInput } from "@comet/ui";
import type { ReactElement } from "react";
import { text, type DataRecord } from "../toolData";
import type { DiaryEntryKind } from "./diaryTypes";
import { DiaryPageWritingArea as WritingArea } from "./DiaryPageWritingArea";
import { envelopeTitle } from "./diaryPageData";
import { deviceTimeZone } from "./plannerData";
import type { DiaryPageComposerDraft } from "./useDiaryPageDraft";
import * as s from "./diaryPage.css";

const KINDS: [DiaryEntryKind, string][] = [
  ["note", "메모"],
  ["todo", "할 일"],
  ["event", "일정"],
  ["envelope", "준비 봉투"],
];

export function DiaryPageComposer({
  draft,
  envelopes,
}: {
  draft: DiaryPageComposerDraft;
  envelopes: DataRecord[];
}): ReactElement {
  const {
    composerOpen,
    setComposerOpen,
    kind,
    body,
    time,
    envelopeId,
    createdTask,
    disabled,
    failure,
    setBody,
    setTime,
    setEnvelopeId,
    changeKind,
    addEntry,
    composerKeyDown,
  } = draft;
  return (
    <>
      {!composerOpen && (
        <button
          type="button"
          className={s.addLine}
          aria-expanded="false"
          onClick={() => setComposerOpen(true)}
        >
          <span aria-hidden="true">＋</span>할 일, 떠오른 생각, 오늘의 일을 한 줄로…
        </button>
      )}
      {composerOpen && (
        <form
          className={s.composer}
          aria-label="새 기록"
          onSubmit={(event) => {
            event.preventDefault();
            void addEntry();
          }}
        >
          <div className={s.kinds} role="group" aria-label="기록 종류">
            {KINDS.map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="small"
                variant={kind === value ? "primary" : "ghost"}
                aria-pressed={kind === value}
                disabled={disabled || !!createdTask}
                onClick={() => changeKind(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {kind === "event" && (
            <div className={s.row}>
              <TextInput
                fill
                type="time"
                className={s.time}
                aria-label="새 일정 시간"
                value={time}
                disabled={disabled}
                onChange={(event) => setTime(event.target.value)}
              />
              <span className={s.meta}>시간 없이 적으면 종일 일정</span>
            </div>
          )}
          {kind === "envelope" && (
            <>
              <Select
                fill
                aria-label="연결할 준비 봉투"
                value={envelopeId}
                disabled={disabled}
                onChange={(event) => setEnvelopeId(event.target.value)}
              >
                <option value="">준비 봉투 고르기</option>
                {envelopes.map((envelope) => (
                  <option key={text(envelope.id)} value={text(envelope.id)}>
                    {envelopeTitle(envelope)}
                  </option>
                ))}
              </Select>
              {!envelopes.length && (
                <p className={s.meta}>
                  내 다이어리에서 준비 봉투를 만든 뒤 이 페이지에 연결할 수 있어요.
                </p>
              )}
            </>
          )}
          <p className={s.meta} id="diary-composer-mode">
            {kind === "todo"
              ? "할 일 작성 · 체크할 수 있는 새 할 일을 만듭니다."
              : kind === "note"
                ? "메모 작성 · 생각과 기록을 자유롭게 남겨요."
                : kind === "event"
                  ? `일정 기록 작성 · 이 페이지에 남기는 기록 · 기기 시간대 ${deviceTimeZone()}`
                  : "준비 봉투 연결 · 기존 봉투를 이 페이지에서 열어요."}
          </p>
          <div className={s.composerBody}>
            <WritingArea
              aria-label="새 기록 내용"
              aria-describedby="diary-composer-mode diary-composer-shortcut"
              value={body}
              autoFocus
              maxLength={kind === "todo" ? 500 : 20000}
              disabled={disabled || !!createdTask}
              placeholder={
                kind === "note"
                  ? "지금 떠오른 생각을 적어 보세요…"
                  : kind === "todo"
                    ? "해야 할 일을 적어 보세요…"
                    : kind === "event"
                      ? "어떤 일정인가요?"
                      : "함께 남길 말이 있나요? (선택)"
              }
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={composerKeyDown}
            />
          </div>
          {failure && (
            <p role="alert" className={s.error}>
              {failure}
            </p>
          )}
          <div className={s.row}>
            <span className={s.meta} id="diary-composer-shortcut">
              {kind === "note"
                ? "줄바꿈은 Enter · 추가는 ⌘/Ctrl+Enter"
                : "Enter로 추가 · Shift+Enter로 줄바꿈"}
            </span>
            <span className={s.spacer} />
            {!body && !time && !envelopeId && !createdTask && (
              <Button
                type="button"
                variant="ghost"
                size="small"
                disabled={disabled}
                onClick={() => setComposerOpen(false)}
              >
                접기
              </Button>
            )}
            <Button
              type="submit"
              disabled={disabled || (kind === "envelope" ? !envelopeId : !body.trim())}
            >
              {createdTask
                ? "페이지에 연결"
                : kind === "todo"
                  ? "할 일 추가"
                  : kind === "note"
                    ? "메모 추가"
                    : kind === "event"
                      ? "일정 기록 추가"
                      : "봉투 연결"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
