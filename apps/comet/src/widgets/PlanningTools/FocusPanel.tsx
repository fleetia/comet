import type { ReactElement, ReactNode } from "react";
import { Icon } from "@comet/icon";
import { IconButton, SegmentedControl } from "@comet/ui";
import panelTail from "./assets/focus-panel-tail.svg";
import * as s from "./FocusTimer.css";

export function FocusPanel({
  tab,
  onTabChange,
  period,
  onPeriodChange,
  onClose,
  hideTabs = false,
  children,
  label = "집중 기록",
}: {
  tab: "records" | "notes";
  onTabChange: (tab: "records" | "notes") => void;
  period?: string;
  onPeriodChange?: (period: string) => void;
  onClose?: () => void;
  hideTabs?: boolean;
  children: ReactNode;
  label?: string;
}): ReactElement {
  return (
    <section className={s.recordsPanel} aria-label={label}>
      <img src={panelTail} alt="" width={14} height={14} className={s.panelTail} />
      <header className={s.panelHeader}>
        <div className={s.panelTools}>
          <Icon name="timer" size={16} className={s.headerTimerIcon} />
          {!hideTabs && (
            <SegmentedControl
              label="집중 기록 보기"
              value={tab}
              options={[
                { value: "records", label: "기록" },
                { value: "notes", label: "노트" },
              ]}
              onValueChange={(value) => {
                if (value === "records" || value === "notes") onTabChange(value);
              }}
            />
          )}
        </div>
        <div className={s.panelTools}>
          {tab === "records" && (
            <SegmentedControl
              label="집중 기록 기간"
              value={period}
              options={[
                { value: "day", label: "일" },
                { value: "week", label: "주" },
                { value: "month", label: "월" },
                { value: "year", label: "년" },
              ]}
              onValueChange={onPeriodChange}
            />
          )}
          {onClose && <IconButton icon="close" aria-label="집중 기록 닫기" onClick={onClose} />}
        </div>
      </header>
      {children}
    </section>
  );
}
