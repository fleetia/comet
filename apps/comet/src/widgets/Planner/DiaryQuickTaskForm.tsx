import { Button, FormField, TextInput } from "@comet/ui";
import type { ReactElement } from "react";
import type { DiaryQuickTask } from "./useDiaryQuickTask";
import * as s from "./diary.css";

export function DiaryQuickTaskForm({
  task,
  saving,
}: {
  task: DiaryQuickTask;
  saving: boolean;
}): ReactElement {
  return (
    <form
      className={s.form}
      aria-label="빠른 할 일"
      onSubmit={async (event) => {
        event.preventDefault();
        await task.submit();
      }}
    >
      <FormField label="빠른 할 일 제목" required>
        <TextInput
          fill
          autoFocus
          maxLength={500}
          value={task.title}
          disabled={saving}
          onChange={(event) => task.change(event.target.value)}
        />
      </FormField>
      <p className={s.caption}>{task.date ? `${task.date} 할 일` : "날짜 없이 모아두기"}</p>
      <div className={s.toolbar}>
        <Button type="submit" variant="primary" disabled={saving || !task.title.trim()}>
          할 일 저장
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={task.hide}>
          닫아두기
        </Button>
      </div>
    </form>
  );
}
