import {
  useId,
  type CSSProperties,
  type FormHTMLAttributes,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@comet/icon";
import { tokens } from "@comet/token";
import { AmountInput, Button, Select, TextInput } from "../controls";
import { classes, cssVar, progressStyle, ratio } from "./shared";
import * as styles from "./planner.css";
import * as ledgerStyles from "./ledger.css";

const ledgerColors = {
  food: tokens["color/ledger-food"],
  delivery: tokens["color/ledger-delivery"],
  cafe: tokens["color/ledger-cafe"],
  transport: tokens["color/ledger-transport"],
  living: tokens["color/ledger-living"],
  culture: tokens["color/ledger-culture"],
  housing: tokens["color/ledger-housing"],
  telecom: tokens["color/ledger-telecom"],
  subscription: tokens["color/ledger-subscription"],
} as const;
export type LedgerCategory = keyof typeof ledgerColors;
export type LedgerCategoryTileProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  category?: LedgerCategory;
  icon?: IconName;
};
export function LedgerCategoryTile({
  category = "food",
  icon = "bowl",
  className,
  style,
  ...props
}: LedgerCategoryTileProps): JSX.Element {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={classes(styles.ledgerTile, className)}
      style={
        {
          [cssVar(styles.accent)]: ledgerColors[category],
          [cssVar(styles.fill)]: `color-mix(in srgb, ${ledgerColors[category]} 15%, transparent)`,
          ...style,
        } as CSSProperties
      }
    >
      <Icon name={icon} size={18} />
    </span>
  );
}

export type LedgerRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> & {
  title: ReactNode;
  description?: ReactNode;
  amount: ReactNode;
  category?: LedgerCategory;
  icon?: IconName;
};
export function LedgerRow({
  title,
  description,
  amount,
  category = "food",
  icon = "bowl",
  className,
  ...props
}: LedgerRowProps): JSX.Element {
  return (
    <div {...props} className={classes(styles.ledgerRow, className)}>
      <LedgerCategoryTile category={category} icon={icon} />
      <div className={classes(styles.stack, styles.grow)}>
        <span>{title}</span>
        {description && <span className={styles.muted}>{description}</span>}
      </div>
      <span className={styles.ledgerAmount}>{amount}</span>
    </div>
  );
}

export type LedgerDayHeaderProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> & {
  title: ReactNode;
  amount: ReactNode;
};
export function LedgerDayHeader({
  title,
  amount,
  className,
  ...props
}: LedgerDayHeaderProps): JSX.Element {
  return (
    <div {...props} className={classes(styles.ledgerDay, className)}>
      <strong>{title}</strong>
      <strong>{amount}</strong>
    </div>
  );
}

export type LedgerQuickAddValue = { amount: string; category: string; memo: string };
export type LedgerQuickAddProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "onSubmit" | "children"
> & {
  categories: readonly { value: string; label: string }[];
  amount?: string;
  category?: string;
  memo?: string;
  defaultAmount?: string;
  defaultCategory?: string;
  defaultMemo?: string;
  disabled?: boolean;
  submitLabel?: string;
  onAmountChange?: (value: string) => void;
  onCategoryChange?: (value: string) => void;
  onMemoChange?: (value: string) => void;
  onAdd?: (value: LedgerQuickAddValue) => void;
};
export function LedgerQuickAdd({
  categories,
  amount,
  category,
  memo,
  defaultAmount,
  defaultCategory,
  defaultMemo,
  disabled = false,
  submitLabel = "추가",
  onAmountChange,
  onCategoryChange,
  onMemoChange,
  onAdd,
  className,
  ...props
}: LedgerQuickAddProps): JSX.Element {
  return (
    <form
      {...props}
      className={classes(styles.quickAdd, className)}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onAdd?.({
          amount: String(data.get("amount") ?? ""),
          category: String(data.get("category") ?? ""),
          memo: String(data.get("memo") ?? ""),
        });
      }}
    >
      <span className={ledgerStyles.amountField}>
        <AmountInput
          aria-label="금액 (원)"
          name="amount"
          inputMode="numeric"
          pattern="(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)"
          maxLength={16}
          required
          placeholder="금액"
          value={amount}
          defaultValue={defaultAmount}
          disabled={disabled}
          onChange={(event) => onAmountChange?.(event.target.value)}
        />
        <span aria-hidden="true" className={ledgerStyles.currency}>
          원
        </span>
      </span>
      <span className={styles.quickCategory}>
        <Select
          aria-label="분류"
          name="category"
          required
          value={category}
          defaultValue={defaultCategory}
          disabled={disabled}
          onChange={(event) => onCategoryChange?.(event.target.value)}
        >
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </span>
      <span className={styles.quickMemo}>
        <TextInput
          aria-label="어디에 썼나요?"
          name="memo"
          placeholder="어디에 썼나요?"
          value={memo}
          defaultValue={defaultMemo}
          disabled={disabled}
          onChange={(event) => onMemoChange?.(event.target.value)}
        />
      </span>
      <Button type="submit" size="small" disabled={disabled}>
        {submitLabel}
      </Button>
    </form>
  );
}

export type LedgerForecastMonth = {
  id: string;
  label: ReactNode;
  recurring: number;
  occasional: number;
  valueLabel?: string;
};
export type Ledger12MonthForecastProps = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
  title?: ReactNode;
  months: readonly LedgerForecastMonth[];
  recurringLabel?: string;
  occasionalLabel?: string;
};
export function Ledger12MonthForecast({
  title = "앞으로 12달",
  months,
  recurringLabel = "매주·매달",
  occasionalLabel = "매년·몇 달마다·특정 달",
  className,
  ...props
}: Ledger12MonthForecastProps): JSX.Element {
  const id = useId();
  const max = Math.max(
    0,
    ...months.map((month) => Math.max(0, month.recurring) + Math.max(0, month.occasional)),
  );
  return (
    <section {...props} aria-labelledby={id} className={classes(styles.forecast, className)}>
      <h3 id={id} className={styles.title}>
        {title}
      </h3>
      <div className={styles.forecastLegend}>
        <span className={styles.forecastRecurringLabel}>{recurringLabel}</span>
        <span className={styles.forecastOccasionalLabel}>{occasionalLabel}</span>
      </div>
      <div className={styles.forecastBars}>
        {months.map((month) => {
          const total = Math.max(0, month.recurring) + Math.max(0, month.occasional);
          return (
            <div key={month.id} className={styles.forecastMonth} aria-label={month.valueLabel}>
              <span className={styles.forecastValue}>{month.valueLabel}</span>
              <span
                aria-hidden
                className={styles.forecastTrack}
                style={{ [cssVar(styles.extent)]: `${ratio(total, max) * 100}%` } as CSSProperties}
              >
                <span
                  className={styles.forecastExtra}
                  style={
                    {
                      [cssVar(styles.extent)]: `${ratio(month.occasional, total) * 100}%`,
                    } as CSSProperties
                  }
                />
              </span>
              <span>{month.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export type LedgerMonthlyBudgetProps = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
  title: ReactNode;
  spent: number;
  budget: number;
  amountLabel: ReactNode;
  budgetLabel?: ReactNode;
  remainingLabel?: ReactNode;
  detail?: ReactNode;
};
export function LedgerMonthlyBudget({
  title,
  spent,
  budget,
  amountLabel,
  budgetLabel,
  remainingLabel,
  detail,
  className,
  ...props
}: LedgerMonthlyBudgetProps): JSX.Element {
  const id = useId();
  return (
    <section {...props} aria-labelledby={id} className={classes(styles.forecast, className)}>
      <h3 id={id} className={styles.budgetTitle}>
        {title}
      </h3>
      <div className={styles.budgetValue}>{amountLabel}</div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="예산 사용률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio(spent, budget) * 100)}
      >
        <div
          className={styles.progress}
          style={progressStyle(spent, budget, ledgerColors.living)}
        />
      </div>
      <div className={styles.budgetFooter}>
        <span>{budgetLabel}</span>
        <span>{remainingLabel}</span>
      </div>
      {detail && <p className={styles.budgetDetail}>{detail}</p>}
    </section>
  );
}

export type LedgerCategorySummaryItem = {
  id: string;
  label: ReactNode;
  amount: number;
  amountLabel: ReactNode;
  percentLabel?: ReactNode;
  category: LedgerCategory;
};
export type LedgerCategorySummaryProps = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
  title?: ReactNode;
  items: readonly LedgerCategorySummaryItem[];
};
export function LedgerCategorySummary({
  title = "분류별",
  items,
  className,
  ...props
}: LedgerCategorySummaryProps): JSX.Element {
  const id = useId();
  const total = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.amount) ? Math.max(0, item.amount) : 0),
    0,
  );
  return (
    <section {...props} aria-labelledby={id} className={classes(styles.forecast, className)}>
      <h3 id={id} className={styles.title}>
        {title}
      </h3>
      <div aria-hidden className={styles.categoryBar}>
        {items.map((item) => (
          <span
            key={item.id}
            className={styles.categorySegment}
            style={progressStyle(item.amount, total, ledgerColors[item.category])}
          />
        ))}
      </div>
      {items.map((item) => (
        <div key={item.id} className={styles.categoryRow}>
          <span
            aria-hidden
            className={styles.dot}
            style={{ [cssVar(styles.accent)]: ledgerColors[item.category] } as CSSProperties}
          />
          <span className={styles.grow}>{item.label}</span>
          <span>{item.amountLabel}</span>
          <span className={styles.categoryPercent}>
            {item.percentLabel ?? `${Math.round(ratio(item.amount, total) * 100)}%`}
          </span>
        </div>
      ))}
    </section>
  );
}

export type LedgerRecurringRowProps = LedgerRowProps & {
  date: ReactNode;
  dateDetail?: ReactNode;
  estimated?: boolean;
};
export function LedgerRecurringRow({
  title,
  description,
  amount,
  category = "telecom",
  icon = "phone",
  date,
  dateDetail,
  estimated = false,
  className,
  ...props
}: LedgerRecurringRowProps): JSX.Element {
  return (
    <div {...props} className={classes(styles.recurringRow, className)} data-estimated={estimated}>
      <LedgerCategoryTile category={category} icon={icon} />
      <div className={classes(styles.stack, styles.grow)}>
        <span>{title}</span>
        <span className={styles.muted}>{description}</span>
      </div>
      <div className={styles.recurringDate}>
        <span>{date}</span>
        <span className={styles.muted}>{dateDetail}</span>
      </div>
      <span className={styles.ledgerAmount}>
        {estimated && "약 "}
        {amount}
      </span>
    </div>
  );
}

export type LedgerRecurringCostsProps = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
  title?: ReactNode;
  summary?: ReactNode;
  items: readonly (LedgerRecurringRowProps & { id: string })[];
};
export function LedgerRecurringCosts({
  title = "매달",
  summary,
  items,
  className,
  ...props
}: LedgerRecurringCostsProps): JSX.Element {
  const id = useId();
  return (
    <section {...props} aria-labelledby={id} className={classes(styles.recurring, className)}>
      <div className={styles.recurringHeader}>
        <h3 id={id} className={styles.title}>
          {title} <span className={styles.muted}>{items.length}</span>
        </h3>
        <span className={styles.muted}>{summary}</span>
      </div>
      <div className={styles.recurringList}>
        {items.map(({ id: itemId, ...item }) => (
          <LedgerRecurringRow key={itemId} {...item} />
        ))}
      </div>
    </section>
  );
}
