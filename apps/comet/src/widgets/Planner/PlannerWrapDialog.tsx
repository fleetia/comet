import { Dialog, Button, Checkbox, TextInput, FormField } from "@comet/ui";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { text, type DataRecord, type ToolAction } from "../toolData";
import * as s from "./planner.css";

export function PlannerWrapDialog({
  isOpen,
  day,
  completedCount,
  remaining,
  rollIds,
  rollDate,
  busy,
  failure,
  act,
  onOpenChange,
  onRollIdsChange,
  onRollDateChange,
}: {
  isOpen: boolean;
  day: string;
  completedCount: number;
  remaining: DataRecord[];
  rollIds: string[];
  rollDate: string;
  busy: boolean;
  failure: { message: string } | null;
  act: ToolAction;
  onOpenChange: (open: boolean) => void;
  onRollIdsChange: Dispatch<SetStateAction<string[]>>;
  onRollDateChange: (date: string) => void;
}): ReactElement {
  return (
    <Dialog
      isOpen={isOpen}
      title={`${day} 하루 마무리`}
      size="small"
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
      }}
      closeLabel="하루 마무리 닫기"
    >
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act("plan", { ids: rollIds, date: rollDate })) onOpenChange(false);
        }}
      >
        {failure && (
          <p role="alert" className={s.error}>
            {failure.message}
          </p>
        )}
        <p className={s.caption}>
          선택일 {day} · 완료 {completedCount}개 · 남은 일 {remaining.length}개. 옮길 일만 골라요.
        </p>
        {remaining.map((item) => (
          <Checkbox
            key={text(item.id)}
            checked={rollIds.includes(text(item.id))}
            onChange={(e) =>
              onRollIdsChange((old) =>
                e.target.checked ? [...old, text(item.id)] : old.filter((id) => id !== item.id),
              )
            }
            label={text(item.title)}
          />
        ))}
        <FormField label="옮길 날짜" className={s.field}>
          <TextInput
            type="date"
            fill
            required
            value={rollDate}
            onChange={(e) => onRollDateChange(e.target.value)}
          />
        </FormField>
        <p className={s.caption}>
          선택하지 않은 일은 {day}에 그대로 남아요. 원래 기한과 계획 기간은 유지합니다.
        </p>
        <div className={s.actions}>
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            그대로 마치기
          </Button>
          <div className={s.spacer} />
          <Button type="submit" variant="primary" disabled={busy || !rollIds.length}>
            선택한 {rollIds.length}개 옮기기
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
