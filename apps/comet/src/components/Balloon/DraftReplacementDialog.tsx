import type { JSX } from "react";
import { Button, Dialog } from "@comet/ui";

export function DraftReplacementDialog({
  open,
  onDismiss,
  onReplace,
}: {
  open: boolean;
  onDismiss: () => void;
  onReplace: () => void;
}): JSX.Element {
  return (
    <Dialog
      isOpen={open}
      title="작성 중인 초안을 바꿀까요?"
      variant="confirm"
      closeLabel="초안 교체 닫기"
      onOpenChange={(isOpen) => {
        if (!isOpen) onDismiss();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={() => onDismiss()}>
            계속 작성
          </Button>
          <Button variant="primary" onClick={onReplace}>
            초안 바꾸기
          </Button>
        </>
      }
    >
      <p>작성 중인 초안 대신 답변을 마치지 못한 입력을 가져와요. 이미 보낸 원문은 그대로 남아요.</p>
    </Dialog>
  );
}
