import { Dialog, Button } from "@comet/ui";
import type { ReactElement } from "react";

export function PlannerCloseDialog({
  isOpen,
  onOpenChange,
  onKeep,
  onDiscard,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onKeep: () => void;
  onDiscard: () => Promise<void>;
}): ReactElement {
  return (
    <Dialog
      isOpen={isOpen}
      title="작성 중인 내용이 있어요"
      variant="confirm"
      closeLabel="플래너 종료 확인 닫기"
      onOpenChange={onOpenChange}
      footer={
        <>
          <Button variant="ghost" onClick={onKeep}>
            계속 작성
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await onDiscard();
            }}
          >
            버리고 나가기
          </Button>
        </>
      }
    >
      <p>저장하지 않은 내용을 버리고 나갈까요?</p>
    </Dialog>
  );
}
