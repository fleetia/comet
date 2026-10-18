import { Dialog, Button, FormField, TextInput } from "@comet/ui";
import type { ReactElement } from "react";
import * as s from "./diary.css";

export function DiaryNewPageDialog({
  isOpen,
  name,
  saving,
  onNameChange,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  name: string;
  saving: boolean;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}): ReactElement {
  return (
    <Dialog
      isOpen={isOpen}
      title="새 페이지"
      size="small"
      closeLabel="새로 만들기 닫기"
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <form
        className={s.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <FormField label="페이지 이름">
          <TextInput
            fill
            autoFocus
            required
            maxLength={500}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="예: 읽은 책"
          />
        </FormField>
        <p className={s.caption}>한 가지 주제를 날짜 없이 계속 이어 쓰세요.</p>
        <Button type="submit" variant="primary" disabled={saving || !name.trim()}>
          만들기
        </Button>
      </form>
    </Dialog>
  );
}
