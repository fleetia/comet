import type { ReactElement, ReactNode } from "react";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import * as s from "./widgetFrame.css";

type Props = {
  title: string;
  status?: string;
  footer?: ReactNode;
  closeLabel: string;
  onClose: () => Promise<void>;
  variant?: "tool" | "note";
  className?: string;
  children: ReactNode;
};

export function WidgetFrame({
  title,
  status,
  footer,
  closeLabel,
  onClose,
  variant = "tool",
  className = "",
  children,
}: Props): ReactElement {
  return (
    <main className={`${s.frame[variant]} ${className}`}>
      <div className={s.fixedHeader}>
        <WindowHeader className={s.header[variant]} label={closeLabel} onClose={onClose}>
          <h1 className={s.title[variant]} title={title}>
            {title}
          </h1>
        </WindowHeader>
      </div>
      <div className={s.content[variant]}>
        {status && <p className={s.status}>{status}</p>}
        {children}
      </div>
      {footer && <footer className={s.footer[variant]}>{footer}</footer>}
    </main>
  );
}
