import {
  useId,
  useState,
  type FieldsetHTMLAttributes,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@comet/icon";
import { IconButton, Radio, Textarea, type RadioProps, type TextareaProps } from "../controls";
import { SegmentedControl } from "../navigation/Navigation";
import { ChartBarItem, type ChartBarItemProps } from "./Chart";
import { classes } from "./shared";
import * as styles from "./planner.css";

export type FocusAppUsageProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  state?: "unselected" | "measuring" | "idle" | "finished";
  program?: ReactNode;
  duration?: ReactNode;
  statusLabel?: ReactNode;
  description?: ReactNode;
  onChoose?: () => void;
  chooseLabel?: string;
};
export function FocusAppUsage({
  state = "unselected",
  program,
  duration,
  statusLabel,
  description,
  onChoose,
  chooseLabel,
  className,
  ...props
}: FocusAppUsageProps): JSX.Element {
  const labels = {
    unselected: "선택한 프로그램 없음",
    measuring: <>{program} 사용 중</>,
    idle: "1분 넘게 입력 없음 · 멈춤",
    finished: "이번 집중 측정 완료",
  };
  const descriptions = {
    unselected: "한 프로그램의 사용 시간을 따로 세요",
    measuring: <>이번 집중 {duration} · 확인된 시간만 세요</>,
    idle: <>이번 집중 {duration}에서 멈춰 있어요</>,
    finished: program,
  };
  return (
    <div {...props} className={classes(styles.focusUsage, className)}>
      <div className={styles.focusUsageHeader}>
        <span className={styles.muted}>앱 전면 사용</span>
        {onChoose && (state === "unselected" || state === "finished") && (
          <button type="button" className={styles.focusUsageChoose} onClick={onChoose}>
            {chooseLabel ?? (state === "finished" ? "바꾸기…" : "고르기…")}
          </button>
        )}
      </div>
      <div className={styles.focusUsageValue}>
        {state !== "unselected" && (
          <span
            aria-hidden
            className={classes(styles.usageDot, state === "idle" && styles.usageIdle)}
          />
        )}
        <strong>{statusLabel ?? labels[state]}</strong>
      </div>
      <span className={styles.secondary}>{description ?? descriptions[state]}</span>
    </div>
  );
}

export type FocusProgramRowProps = RadioProps & { icon?: IconName };
export function FocusProgramRow({
  label,
  icon,
  className,
  ...props
}: FocusProgramRowProps): JSX.Element {
  return (
    <div className={classes(styles.programRow, className)}>
      <Radio
        {...props}
        label={
          <span className={styles.row}>
            {icon && (
              <span className={styles.programIcon}>
                <Icon name={icon} size={13} />
              </span>
            )}
            {label}
          </span>
        }
      />
    </div>
  );
}

export type FocusProgramOption = {
  value: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
};
export type FocusProgramPickerProps = Omit<
  FieldsetHTMLAttributes<HTMLFieldSetElement>,
  "onChange" | "defaultValue"
> & {
  label: string;
  name?: string;
  options: readonly FocusProgramOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};
export function FocusProgramPicker({
  label,
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: FocusProgramPickerProps): JSX.Element {
  const id = useId();
  return (
    <fieldset {...props} className={classes(styles.programPicker, className)}>
      <legend className={styles.visuallyHidden}>{label}</legend>
      {options.map((option) => (
        <FocusProgramRow
          key={option.value}
          name={name ?? id}
          value={option.value}
          label={option.label}
          icon={option.icon}
          disabled={option.disabled}
          checked={value === undefined ? undefined : value === option.value}
          defaultChecked={value === undefined ? defaultValue === option.value : undefined}
          onChange={(event) => {
            if (event.target.checked) {
              onValueChange?.(option.value);
            }
          }}
        />
      ))}
    </fieldset>
  );
}

export type FocusRecordRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> & {
  time: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  duration: ReactNode;
};
export function FocusRecordRow({
  time,
  title,
  description,
  duration,
  className,
  ...props
}: FocusRecordRowProps): JSX.Element {
  return (
    <div {...props} className={classes(styles.focusRecord, className)}>
      <span className={styles.focusRecordTime}>{time}</span>
      <div className={classes(styles.stack, styles.grow)}>
        <strong>{title}</strong>
        {description && <span className={styles.muted}>{description}</span>}
      </div>
      <span className={styles.focusRecordDuration}>{duration}</span>
    </div>
  );
}

export type FocusRecordsPanelProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  tab?: "records" | "notes";
  defaultTab?: "records" | "notes";
  onTabChange?: (tab: "records" | "notes") => void;
  period?: "day" | "week" | "month" | "year";
  onPeriodChange?: (period: string) => void;
  periodLabel?: ReactNode;
  total?: ReactNode;
  summary?: ReactNode;
  bars?: readonly (ChartBarItemProps & { id: string })[];
  records?: readonly (FocusRecordRowProps & { id: string })[];
  recordsLabel?: ReactNode;
  help?: ReactNode;
  note?: TextareaProps;
  notesHeader?: ReactNode;
  notesContent?: ReactNode;
  notesActions?: ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose?: () => void;
};
export function FocusRecordsPanel({
  tab,
  defaultTab = "records",
  onTabChange,
  period,
  onPeriodChange,
  periodLabel,
  total,
  summary,
  bars = [],
  records = [],
  recordsLabel = "집중 기록",
  help,
  note,
  notesHeader,
  notesContent,
  notesActions,
  onPrevious,
  onNext,
  onClose,
  className,
  ...props
}: FocusRecordsPanelProps): JSX.Element {
  const [internalTab, setInternalTab] = useState(defaultTab);
  const activeTab = tab ?? internalTab;
  const id = useId();
  return (
    <section
      {...props}
      aria-label={props["aria-label"] ?? "집중 기록"}
      className={classes(styles.focusPanel, className)}
    >
      <div className={styles.focusPanelHeader}>
        <div className={styles.focusPanelTools}>
          <Icon name="timer" size={16} />
          <SegmentedControl
            label="집중 기록 보기"
            value={activeTab}
            options={[
              { value: "records", label: "기록" },
              { value: "notes", label: "노트" },
            ]}
            onValueChange={(value) => {
              if (value === "records" || value === "notes") {
                if (tab === undefined) {
                  setInternalTab(value);
                }
                onTabChange?.(value);
              }
            }}
          />
        </div>
        <div className={styles.focusPanelTools}>
          {activeTab === "records" && (
            <SegmentedControl
              label="집중 기록 기간"
              value={period}
              defaultValue="week"
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
      </div>
      <div hidden={activeTab !== "records"}>
        <span className={styles.muted}>{periodLabel}</span>
        <div className={styles.focusPeriod}>
          <div className={styles.row}>
            <span className={styles.display}>{total}</span>
            <span className={styles.secondary}>{summary}</span>
          </div>
          <div className={styles.focusPanelTools}>
            {onPrevious && (
              <IconButton icon="chevleft" aria-label="이전 기간" onClick={onPrevious} />
            )}
            {onNext && <IconButton icon="chev" aria-label="다음 기간" onClick={onNext} />}
          </div>
        </div>
        <div className={styles.focusChart}>
          {bars.map(({ id: barId, ...bar }) => (
            <ChartBarItem key={barId} {...bar} />
          ))}
        </div>
        {help && <p className={styles.muted}>{help}</p>}
        <h3 id={id} className={styles.title}>
          {recordsLabel}
        </h3>
        <div className={styles.focusRecordList} aria-labelledby={recordsLabel ? id : undefined}>
          {records.map(({ id: recordId, ...record }) => (
            <FocusRecordRow key={recordId} {...record} />
          ))}
        </div>
      </div>
      <div hidden={activeTab !== "notes"}>
        <div className={styles.stack}>
          {notesHeader}
          {note && (
            <Textarea
              {...note}
              label={note.label ?? "이번 집중 메모"}
              className={classes(styles.notes, note.className)}
            />
          )}
          {notesContent}
          {notesActions && <div className={styles.row}>{notesActions}</div>}
        </div>
      </div>
    </section>
  );
}
