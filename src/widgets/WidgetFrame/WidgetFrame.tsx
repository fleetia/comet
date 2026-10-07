import type { ReactElement, ReactNode } from "react";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import * as s from "./widgetFrame.css";

type Props = {
  title: string;
  status?: string;
  headerActions?: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  onClose: () => Promise<void>;
  variant?: "tool" | "note";
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

export function WidgetFrame({
  title,
  status,
  headerActions,
  footer,
  closeLabel,
  onClose,
  variant = "tool",
  className = "",
  contentClassName = "",
  children,
}: Props): ReactElement {
  return (
    <main className={`${s.frame[variant]} ${className}`}>
      <div className={s.fixedHeader}>
        <WindowHeader
          className={s.header[variant]}
          label={closeLabel}
          onClose={onClose}
          title={title}
          actions={headerActions}
        />
      </div>
      <div className={`${s.content[variant]} ${contentClassName}`}>
        {status && <p className={s.status}>{status}</p>}
        {children}
      </div>
      {footer && <footer className={s.footer[variant]}>{footer}</footer>}
    </main>
  );
}
