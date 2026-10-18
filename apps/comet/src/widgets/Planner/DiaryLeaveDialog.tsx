import { Dialog, Button } from "@comet/ui";
import type { ReactElement } from "react";
import type { DiaryLeave } from "./useDiaryLeave";

export function DiaryLeaveDialog({
  leave,
  saving,
  onContinue,
  onDiscard,
}: {
  leave: DiaryLeave | null;
  saving: boolean;
  onContinue: () => void;
  onDiscard: () => void;
}): ReactElement {
  return (
    <Dialog
      isOpen={Boolean(leave)}
      title="작성 중인 내용이 있어요"
      variant="confirm"
      closeLabel="작성 계속하기"
      onOpenChange={(open) => {
        if (!open) onContinue();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onContinue}>
            계속 작성
          </Button>
          <Button variant="danger" disabled={saving} onClick={onDiscard}>
            {leave?.closing ? "저장하지 않고 닫기" : "저장하지 않고 이동"}
          </Button>
        </>
      }
    >
      <p>
        저장하지 않은 내용을 확인하고{" "}
        {leave?.closing ? "다이어리를 닫을까요?" : "다른 페이지로 이동할까요?"}
      </p>
    </Dialog>
  );
}
