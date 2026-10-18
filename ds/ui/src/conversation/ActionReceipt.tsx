import { useId, type HTMLAttributes, type JSX } from "react";
import { Button } from "../controls/Button";
import * as styles from "./actionReceipt.css";

export type ActionReceiptProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  undone?: boolean;
  pending?: boolean;
  undoSupported?: boolean;
  undoReason?: string | null;
  onOpen: () => void;
  onUndo: () => void;
};

export function ActionReceipt({
  title,
  undone = false,
  pending = false,
  undoSupported = true,
  undoReason,
  onOpen,
  onUndo,
  className,
  ...props
}: ActionReceiptProps): JSX.Element {
  const reasonId = useId();
  const status = pending ? "처리 중" : undone ? "되돌림" : "완료";
  return (
    <div
      {...props}
      role="group"
      aria-label={title}
      aria-busy={pending}
      className={[styles.receipt, className].filter(Boolean).join(" ")}
    >
      <span className={styles.title}>{title}</span>
      <span className={styles.detail} role="status">
        {status}
      </span>
      {!undoSupported && !undone && (
        <span id={reasonId} className={styles.detail}>
          {undoReason?.trim() || "이 동작은 되돌릴 수 없어요."}
        </span>
      )}
      <div className={styles.actions}>
        <Button variant="ghost" size="small" disabled={pending} onClick={onOpen}>
          열기
        </Button>
        <Button
          variant="ghost"
          size="small"
          disabled={pending || undone || !undoSupported}
          aria-describedby={!undoSupported && !undone ? reasonId : undefined}
          onClick={onUndo}
        >
          되돌리기
        </Button>
      </div>
    </div>
  );
}
